// Type stubs so TypeScript understands the wrangler Text-rule imports for the
// storefront assets (see [[rules]] in wrangler.toml).

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.txt" {
  const content: string;
  export default content;
}
