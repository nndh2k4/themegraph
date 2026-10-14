import { CoreModule } from "@themegraph/core";

import { ThemesController } from "./controllers/themes.controller.js";
import { LocalHostGuard } from "./guards/local-host.guard.js";
import { HttpExceptionFilter } from "./http.exception-filter.js";
import { HttpRouter } from "./http.router.js";

/** Module của server HTTP: nối lõi, controller, router, guard và filter. */
export class ServerModule {
  readonly router: HttpRouter;
  readonly guard = new LocalHostGuard();

  constructor() {
    const { themes, graphs } = new CoreModule();
    this.router = new HttpRouter(new ThemesController(themes, graphs), new HttpExceptionFilter());
  }
}
