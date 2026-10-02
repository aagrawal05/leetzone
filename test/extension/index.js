// Lets `node --test test/extension/` work: Node runs a directory argument as a
// module, so this is its entry. `node --test "test/extension/*.test.mjs"` skips it.
import "./background.test.mjs";
import "./hook.test.mjs";
import "./leetcode.test.mjs";
