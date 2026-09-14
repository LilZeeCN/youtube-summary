import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const context = { URL };
context.globalThis = context;
vm.runInNewContext(
  readFileSync(new URL("../content/bili-provenance.js", import.meta.url), "utf8"),
  context
);
const provenance = context.__videoSummaryBiliProvenance;

test("rejects an AI subtitle URL belonging to another Bilibili video", () => {
  const currentAid = "117093760504067";
  const currentCid = "40909670979";
  const wrongUrl =
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11325380808410926151356944e178359b977b77";

  assert.equal(provenance.isOwnedSubtitleUrl(wrongUrl, currentAid, currentCid), false);
});

test("accepts the current video's AI subtitle URL", () => {
  const currentUrl =
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11709376050406740909670979b36e8ebf64337d";

  assert.equal(
    provenance.isOwnedSubtitleUrl(currentUrl, "117093760504067", "40909670979"),
    true
  );
});

test("accepts AI translation tracks whose URL embeds no video identity", () => {
  // wbi/v2 实测：ai-en 等翻译轨道是纯哈希路径，无法从 URL 校验归属，交由覆盖范围校验兜底
  const translatedUrl =
    "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/d71ce4d602a44cb34cabce9371f48430f23f3abe7b6fc6f162673b?auth_key=1726370540-x-y";

  assert.equal(
    provenance.isOwnedSubtitleUrl(translatedUrl, "116901745467302", "39858802320"),
    true
  );
});

test("accepts CC subtitle URLs on the hashed /bfs/subtitle/ path", () => {
  const ccUrl =
    "https://aisubtitle.hdslb.com/bfs/subtitle/c49b18a284739d99df1e3723cdf72c0c82db98e0.json?auth_key=1725003260-x-y";

  assert.equal(
    provenance.isOwnedSubtitleUrl(ccUrl, "116901745467302", "39858802320"),
    true
  );
});

test("cache busting preserves the subtitle resource and existing parameters", () => {
  const busted = new URL(provenance.withCacheBust("https://example.com/subtitle.json?lang=zh", 42));

  assert.equal(busted.origin + busted.pathname, "https://example.com/subtitle.json");
  assert.equal(busted.searchParams.get("lang"), "zh");
  assert.equal(busted.searchParams.get("_vsa"), "42");
});

test("rejects subtitle bodies that cover only a small fraction of a long video", () => {
  const unrelatedBody = [
    { from: 95, to: 101, content: "多少有也不能给" },
    { from: 175, to: 183, content: "敌方兵力剩余不多" },
  ];

  assert.equal(provenance.hasPlausibleCoverage(unrelatedBody, 1325), false);
  assert.equal(
    provenance.hasPlausibleCoverage([{ from: 2, to: 1290, content: "课程结束" }], 1325),
    true
  );
});
