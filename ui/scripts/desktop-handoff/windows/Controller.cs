using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;
using Accessibility;

// Application transport only. Never writes Claude metadata, runs a model CLI,
// changes authentication, or accepts a permission dialog.
public static class DesktopHandoffController {
    public static string Phase = "preflight";
    public static string Step = "initializing";
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible container, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int obtained);
    static AutomationElement root; static Process process; static string stop;
    static string Name(AutomationElement e) { return e.Current.Name ?? ""; }
    static List<AutomationElement> Elements() { return root.FindAll(TreeScope.Descendants, Condition.TrueCondition).Cast<AutomationElement>().ToList(); }
    static bool Is(AutomationElement e, ControlType t) { return e.Current.ControlType == t; }
    static AutomationElement One(Func<AutomationElement,bool> match) {
        var list = Elements().Where(match).ToList();
        if (list.Count != 1) throw new Exception("Ambiguous or missing Desktop control: " + list.Count);
        return list[0];
    }
    static void Guard() {
        if (File.Exists(stop)) throw new Exception("Stopped by user");
        uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        if (pid != process.Id) throw new Exception("Desktop focus changed; stopped without retrying input");
    }
    static void AwaitInitialFocus() {
        // The coordinator may finish launching while the human returns from the
        // dashboard. Wait without stealing focus or sending any input.
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < deadline) {
            if (File.Exists(stop)) throw new Exception("Stopped by user");
            uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            if (pid == process.Id) return;
            Thread.Sleep(250);
        }
        throw new Exception("Claude Desktop was not foreground within 45 seconds; no input sent. Bring Claude forward and retry the same package.");
    }
    static void Wait() { Thread.Sleep(350); Guard(); }
    static void Click(AutomationElement e) {
        Guard(); object p;
        if (!e.Current.IsEnabled) throw new Exception("Desktop control is disabled: " + Name(e));
        if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) ((InvokePattern)p).Invoke();
        else if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) {
            var expansion = (ExpandCollapsePattern)p;
            if (expansion.Current.ExpandCollapseState != ExpandCollapseState.Expanded) expansion.Expand();
        }
        else if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) ((SelectionItemPattern)p).Select();
        else throw new Exception("Desktop control exposes no Invoke, ExpandCollapse or SelectionItem pattern: " + Name(e));
        Wait();
    }
    static void Keys(string keys) { Guard(); SendKeys.SendWait(keys); Wait(); }
    static void Paste(string text) {
        Guard(); var original = Clipboard.GetDataObject();
        try { Clipboard.SetText(text); SendKeys.SendWait("^v"); Thread.Sleep(200); }
        finally { if (original != null) Clipboard.SetDataObject(original, true); else Clipboard.Clear(); }
        Wait();
    }
    static string Value(AutomationElement e) {
        object p;
        if (e.TryGetCurrentPattern(ValuePattern.Pattern,out p)) return ((ValuePattern)p).Current.Value;
        // Native LegacyIAccessible Value property, when exposed by this runtime.
        // https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-control-pattern-propids
        var legacy = AutomationProperty.LookupById(30093);
        if (legacy != null) return e.GetCurrentPropertyValue(legacy, true) as string ?? "";
        return "";
    }
    public static string NormalizeEditorText(string value) {
        return (value ?? "").Replace("\r\n", "\n").Replace("\r", "\n").TrimEnd('\n');
    }
    static void Write(AutomationElement e, string value, bool pasteOnly = false) {
        Step = "editor-focus";
        Guard(); e.SetFocus(); Wait(); object p;
        bool written = false;
        if (!pasteOnly && e.TryGetCurrentPattern(ValuePattern.Pattern, out p) && !((ValuePattern)p).Current.IsReadOnly) {
            Step = "editor-set-value";
            try { ((ValuePattern)p).SetValue(value); written = true; }
            catch { /* Chromium may advertise ValuePattern but reject writes. */ }
        }
        if (!written) {
            Step = "editor-select-all";
            Guard(); e.SetFocus(); Wait();
            if (!e.Current.HasKeyboardFocus) throw new Exception("Editor focus could not be verified; nothing pasted");
            Keys("^a");
            Step = "editor-paste";
            Paste(value);
        }
        Wait();
    }
    static string DocumentUrl() {
        var values = Elements().Where(e => Is(e, ControlType.Document)).Select(Value);
        var url = values.FirstOrDefault(x => x.Contains("claude.ai/epitaxy/local_"));
        if (!String.IsNullOrEmpty(url)) return url;
        // Document URL may be exposed only as MSAA accValue by Chromium.
        // Standard accessibility bridge; no vendor IPC or account-store writes.
        object accessible; var iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
        if (AccessibleObjectFromWindow(process.MainWindowHandle, 0xFFFFFFFC, ref iid, out accessible) != 0) return "";
        int remaining=6000; return AccessibleUrl(accessible as IAccessible,0,ref remaining);
    }
    static string AccessibleUrl(IAccessible accessible, int depth, ref int remaining) {
        if (accessible==null || depth>30 || --remaining<0) return "";
        try {
            var value=accessible.get_accValue(0) ?? "";
            if (value.Contains("claude.ai/epitaxy/local_")) return value;
            var count=Math.Min(accessible.accChildCount,6000);
            if (count<=0) return "";
            var children=new object[count];int obtained;
            AccessibleChildren(accessible,0,count,children,out obtained);
            for (int i=0;i<obtained && remaining>0;i++) {
                var child=children[i] as IAccessible;
                if (child!=null) { var found=AccessibleUrl(child,depth+1,ref remaining);if(found!="")return found; }
            }
        } catch { /* A stale accessibility branch is not URL evidence. */ }
        return "";
    }
    static string ReadTitle() {
        var e = One(x => Is(x, ControlType.Button) && Name(x).EndsWith(", rename session"));
        return Name(e).Substring(0, Name(e).Length - ", rename session".Length);
    }
    static void Init(string stopFile) {
        stop = stopFile;
        var candidates = Process.GetProcessesByName("claude").Where(p => {
            try { return p.MainWindowHandle != IntPtr.Zero && p.MainModule.FileName.IndexOf("AnthropicClaude", StringComparison.OrdinalIgnoreCase) >= 0; } catch { return false; }
        }).ToList();
        if (candidates.Count != 1) throw new Exception("Expected one Claude Desktop window; found " + candidates.Count);
        process = candidates[0]; root = AutomationElement.FromHandle(process.MainWindowHandle);
    }
    public static string[] Run(string action, string cwd, string text, string title, string expectedSession, string stopFile) {
        Init(stopFile);
        if (action == "probe") return new [] { DocumentUrl(), ReadTitle(), process.Id.ToString() };
        AwaitInitialFocus(); Guard();
        if (action == "probe-ready") return new [] { DocumentUrl(), "", process.Id.ToString() };
        if (action == "open") {
            if (String.IsNullOrEmpty(expectedSession) || !expectedSession.StartsWith("local_")) throw new Exception("Invalid destination session");
            if (!DocumentUrl().EndsWith("/" + expectedSession)) {
                Step = "destination-locate";
                var destination = One(x => (Is(x, ControlType.Button) || Is(x, ControlType.ListItem) || Is(x, ControlType.Hyperlink)) && Name(x) == title);
                Step = "destination-open";
                Click(destination);
                for (int i=0;i<12 && !DocumentUrl().EndsWith("/" + expectedSession);i++) Wait();
            }
            if (!DocumentUrl().EndsWith("/" + expectedSession)) throw new Exception("Selected sidebar conversation did not match destination ID; no message sent");
            return new [] { DocumentUrl(), ReadTitle(), process.Id.ToString() };
        }
        if (action == "title") {
            if (!DocumentUrl().EndsWith("/" + expectedSession)) throw new Exception("Unexpected destination conversation");
            Click(One(x => Is(x, ControlType.Button) && Name(x).EndsWith(", rename session")));
            Write(One(x => Is(x, ControlType.Edit) && Name(x) == "Session name"), title); Keys("{ENTER}");
            if (ReadTitle() != title) throw new Exception("Title mismatch after native rename");
            return new [] { DocumentUrl(), ReadTitle(), process.Id.ToString() };
        }
        if (action != "create") throw new Exception("Unsupported Desktop action");
        if (!Directory.Exists(cwd)) throw new Exception("Project directory unavailable");
        var code = One(x => Is(x, ControlType.RadioButton) && Name(x) == "Code");
        object selection;
        if (code.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selection) && !((SelectionItemPattern)selection).Current.IsSelected) {
            Guard(); ((SelectionItemPattern)selection).Select(); Wait();
        }
        Phase = "opening";
        Click(One(x => Is(x, ControlType.Button) && Name(x) == "New"));
        var local = One(x => Is(x, ControlType.Button) && Name(x) == "Local");
        var r = local.Current.BoundingRectangle;
        var project = One(x => Is(x, ControlType.Button) && x.Current.BoundingRectangle.Left > r.Right && Math.Abs(x.Current.BoundingRectangle.Top-r.Top) < 12 && Name(x) != "Add another folder");
        Click(project);
        Click(One(x => (Is(x, ControlType.Button) || Is(x, ControlType.MenuItem)) && Name(x).Replace("…", "...") == "Open folder..."));
        // Owned folder dialog must belong to the selected Claude process.
        var dialog = One(x => Is(x, ControlType.Window) && Name(x) == "Select folder for local session");
        if (dialog.Current.ProcessId != process.Id) throw new Exception("Unexpected folder dialog owner");
        Keys("%d"); Paste(cwd); Keys("{ENTER}"); Keys("%d");
        var address = One(x => Is(x, ControlType.Edit) && Name(x) == "Address");
        if (!String.Equals(Path.GetFullPath(Value(address)).TrimEnd('\\'), Path.GetFullPath(cwd).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new Exception("Folder picker path mismatch");
        Click(One(x => Is(x, ControlType.Button) && Name(x) == "Select Folder"));
        One(x => Is(x, ControlType.Button) && Name(x) == Path.GetFileName(cwd.TrimEnd('\\','/')));
        Step = "prompt-locate";
        var prompt = One(x => Is(x, ControlType.Edit) && Name(x) == "Prompt");
        Phase = "composing";
        // ProseMirror contenteditable is written through the native paste path.
        Write(prompt, text, true);
        Step = "prompt-read-back";
        var deadline = DateTime.UtcNow.AddSeconds(4);
        bool matches = false;
        do {
            Guard();
            prompt = One(x => Is(x, ControlType.Edit) && Name(x) == "Prompt");
            matches = NormalizeEditorText(Value(prompt)) == NormalizeEditorText(text);
            if (matches) break;
            Thread.Sleep(250);
        } while (DateTime.UtcNow < deadline);
        if (!matches) throw new Exception("Prompt read-back mismatch; nothing submitted");
        Step = "send-locate";
        var send = One(x => Is(x, ControlType.Button) && Name(x) == "Send");
        Phase = "submitting";
        Step = "send-invoke";
        Click(send);
        Phase = "submitted";
        // Submission must never be retried on a missing observation.
        for (int i=0; i<30 && DocumentUrl()==""; i++) Wait();
        return new [] { DocumentUrl(), "", process.Id.ToString() };
    }
}
