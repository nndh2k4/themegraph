import type { GraphStore } from "../graph/graph.store.js";
import type { ThemeFileRepository } from "../theme/theme-file.repository.js";
import type { ThemeRegistryRepository } from "../theme/theme-registry.repository.js";
import type { ThemeScanner } from "../theme/theme-scanner.js";
import { AnalyzeService } from "./analyze.service.js";
import { GraphBuilder } from "./graph-builder.js";
import { defaultParsers } from "./parsers/index.js";
import { ThemeFileParser } from "./parsers/theme-file.parser.js";

/** Module phân tích theme. Để lộ một provider: `analyzer`. */
export class AnalyzeModule {
  readonly analyzer: AnalyzeService;

  constructor(scanner: ThemeScanner, files: ThemeFileRepository, store: GraphStore, registry: ThemeRegistryRepository) {
    const parser = new ThemeFileParser(defaultParsers());
    const builder = new GraphBuilder();
    this.analyzer = new AnalyzeService(scanner, files, parser, builder, store, registry);
  }
}
