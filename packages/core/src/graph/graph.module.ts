import { GraphScopeFactory } from "./graph-scope.js";
import type { GraphStore } from "./graph.store.js";

/**
 * Module truy vấn đồ thị. Nhận nơi lưu trữ đồ thị, để lộ một provider:
 * `scopes`, thứ mở đồ thị của một theme thành các service truy vấn.
 */
export class GraphModule {
  readonly scopes: GraphScopeFactory;

  constructor(store: GraphStore) {
    this.scopes = new GraphScopeFactory(store);
  }
}
