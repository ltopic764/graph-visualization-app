import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appJsPath = join(__dirname, "..", "static", "js", "app.js");
const source = readFileSync(appJsPath, "utf-8");

test("filter chip is appended only after a successful backend filter response", () => {
    const pattern =
        /const applied = await sendFilterRequest\(attribute, operator, value\);\s*if \(!applied\)\s*{\s*return;\s*}\s*state\.queryUI\.appliedChips = state\.queryUI\.appliedChips\.concat\(createAppliedChip/s;
    assert.match(source, pattern);
});

test("backend filter errors are handled as non-applied requests in frontend flow", () => {
    const pattern = /if \(!result\.ok\)\s*{\s*showFilterErrorMessage\(result\.message\);\s*return false;\s*}/s;
    assert.match(source, pattern);
});
