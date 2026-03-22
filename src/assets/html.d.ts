declare module "*.html" {
  const content: string;
  export default content;
}

declare module "virtual:mcp-app-bundle" {
  const code: string;
  export default code;
}
