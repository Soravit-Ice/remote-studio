import { expect, it } from "vitest";
import {
  ownedDescendants,
  type ProcessInfo,
} from "../../packages/terminal/src/recovery";
const p = (
  pid: number,
  parent: number,
  identity = String(pid),
): ProcessInfo => ({ pid, parent, identity, group: pid });
it("follows only birth-verified parents, including detached descendants", () => {
  expect(
    ownedDescendants(
      [p(4, 3), p(3, 2), p(2, 1), p(20, 0), p(21, 20), p(30, 999)],
      [{ pid: 2, identity: "2" }],
    ),
  ).toEqual([
    { pid: 2, identity: "2" },
    { pid: 3, identity: "3" },
    { pid: 4, identity: "4" },
  ]);
});
it("does not follow missing parents or a reused PID", () => {
  expect(
    ownedDescendants(
      [p(2, 1, "new birth"), p(3, 2), p(5, 999), p(6, 5)],
      [
        { pid: 2, identity: "old birth" },
        { pid: 999, identity: "gone" },
      ],
    ),
  ).toEqual([
    { pid: 2, identity: "old birth" },
    { pid: 999, identity: "gone" },
  ]);
});
