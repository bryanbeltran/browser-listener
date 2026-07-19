import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { resetNetworkStoreForTests } from "../src/persistence/store.js";

beforeEach(async () => {
  await resetNetworkStoreForTests();
});
