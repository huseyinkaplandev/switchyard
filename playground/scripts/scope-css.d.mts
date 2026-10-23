import type { PluginCreator } from 'postcss';
export declare const scopeCss: PluginCreator<{ rootClass?: string; viewportSelectors?: RegExp[]; dropFontFamilies?: RegExp[] }>;
