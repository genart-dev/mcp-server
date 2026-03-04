/**
 * Ambient module declarations for design plugins.
 * These packages have DTS disabled (private workspace packages with
 * link: protocol dependencies). Their default exports are DesignPlugin
 * instances, so we declare them with the correct type.
 */

declare module "@genart-dev/plugin-typography" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}

declare module "@genart-dev/plugin-filters" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}

declare module "@genart-dev/plugin-shapes" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}

declare module "@genart-dev/plugin-layout-guides" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}

declare module "@genart-dev/plugin-painting" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}

declare module "@genart-dev/plugin-textures" {
  import type { DesignPlugin } from "@genart-dev/core";
  const plugin: DesignPlugin;
  export default plugin;
}
