function latinKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function variantIdentity(value) {
  return String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return prev[b.length];
}

function titleTerms(title) {
  const terms = [];
  const runs = String(title || "").match(/[A-Za-z][A-Za-z0-9.+#/-]*(?:\s+[A-Za-z][A-Za-z0-9.+#/-]*)*/g) || [];
  for (const run of runs) {
    const words = run.trim().split(/\s+/);
    for (let size = 1; size <= Math.min(4, words.length); size++) {
      for (let start = 0; start + size <= words.length; start++) {
        const term = words.slice(start, start + size).join(" ");
        if (latinKey(term).length >= 3) terms.push(term);
      }
    }
  }
  return [...new Set(terms)].sort((a, b) => latinKey(b).length - latinKey(a).length);
}

function closestTitleTerm(candidates, terms) {
  let best = null;
  for (const term of terms) {
    const termKey = latinKey(term);
    for (const candidate of candidates) {
      const candidateKey = latinKey(candidate);
      if (!candidateKey) continue;
      const distance = editDistance(candidateKey, termKey);
      const allowed = Math.max(1, Math.floor(termKey.length * 0.25));
      if (distance <= allowed && (!best || distance < best.distance)) {
        best = { term, distance };
      }
    }
  }
  return best && best.term;
}

export function normalizeTerminologyGuide(guide, videoTitle) {
  const terms = titleTerms(videoTitle);
  if (!terms.length) return String(guide || "").trim();

  return String(guide || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(.*?)\s*[→➡]\s*(.*?)\s*$/);
      if (!match) return line.trim();

      const variants = match[1].split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
      const modelCanonical = match[2].trim();
      const titleCanonical = closestTitleTerm([...variants, modelCanonical], terms);
      if (!titleCanonical) return `${variants.join("、")} → ${modelCanonical}`;

      const canonicalKey = latinKey(titleCanonical);
      const correctedVariants = [...variants, modelCanonical].filter(
        (item, index, all) =>
          latinKey(item) !== canonicalKey &&
          all.findIndex((other) => variantIdentity(other) === variantIdentity(item)) === index
      );
      if (!correctedVariants.length) return line.trim();
      return `${correctedVariants.join("、")} → ${titleCanonical}`;
    })
    .filter(Boolean)
    .join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyTerminologyGuide(text, guide) {
  let output = String(text || "");
  for (const line of String(guide || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(.*?)\s*[→➡]\s*(.*?)\s*$/);
    if (!match) continue;
    const canonical = match[2].trim();
    const variants = match[1]
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const variant of variants) {
      const pattern = escapeRegExp(variant).replace(/\s+/g, "\\s+");
      const latinBoundaries = /^[A-Za-z0-9]/.test(variant) && /[A-Za-z0-9]$/.test(variant);
      const regex = new RegExp(
        latinBoundaries ? `(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])` : pattern,
        "gi"
      );
      output = output.replace(regex, () => canonical);
    }
  }
  return output;
}
