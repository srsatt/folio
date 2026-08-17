import jetBrainsMonoPath from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2" with { type: "file" };

export { jetBrainsMonoPath };

let embeddedFontCss: Promise<string> | null = null;

export function embeddedJetBrainsMonoFontCss(): Promise<string> {
  embeddedFontCss ??= Bun.file(jetBrainsMonoPath).arrayBuffer().then((bytes) => {
    const base64 = Buffer.from(bytes).toString("base64");
    return `@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url(data:font/woff2;base64,${base64}) format("woff2")}`;
  });
  return embeddedFontCss;
}

export const servedJetBrainsMonoFontCss = '@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:100 800;font-display:swap;src:url("/assets/jetbrains-mono.woff2") format("woff2")}';
