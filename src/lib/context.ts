export function buildContext(docs: any[]) {
  return docs
    .map((d, i) => {
      return `Source ${i + 1}:
${d.fullAnswer}`;
    })
    .join("\n\n");
}