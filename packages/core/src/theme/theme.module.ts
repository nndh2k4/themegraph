import type { GraphStore } from "../graph/graph.store.js";
import type { ThemeFileRepository } from "./theme-file.repository.js";
import type { ThemeRegistryRepository } from "./theme-registry.repository.js";
import { ThemeScanner } from "./theme-scanner.js";
import { ThemeService } from "./theme.service.js";

/**
 * Module quản lý theme. Để lộ hai provider: `scanner` (module analyze cũng
 * dùng) và `themes`.
 */
export class ThemeModule {
  readonly scanner: ThemeScanner;
  readonly themes: ThemeService;

  constructor(registry: ThemeRegistryRepository, files: ThemeFileRepository, store: GraphStore) {
    this.scanner = new ThemeScanner(files);
    this.themes = new ThemeService(registry, store, this.scanner, files);
  }
}
