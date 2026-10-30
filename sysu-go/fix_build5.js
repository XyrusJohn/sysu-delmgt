const fs = require("fs");
let c = fs.readFileSync(
  "C:/Users/xyver/StudioProjects/sysu-go/app/build.gradle.kts",
  "utf8",
);
const idx = c.indexOf("devBuild");
if (idx < 0) {
  console.log("devBuild not found");
  process.exit(0);
}

// Find start of line containing devBuild (look back for \n or start of file)
let lineStart = idx;
while (lineStart > 0 && c[lineStart - 1] !== "\n" && c[lineStart - 1] !== "\r")
  lineStart--;

// Find the closing } of the devBuild block - look for the }\n\n pattern after idx
let closeIdx = c.indexOf("}", idx);
while (closeIdx < c.length) {
  if (
    c[closeIdx + 1] === "\n" &&
    c[closeIdx + 2] === "\r" &&
    c[closeIdx + 3] === "\n"
  ) {
    // This is the close, preceded by newline at closeIdx-1
    break;
  }
  if (c[closeIdx + 1] === "\n" && c[closeIdx + 2] === "\n") {
    break;
  }
  closeIdx = c.indexOf("}", closeIdx + 1);
}

// closeIdx+1 to include the }
const block = c.slice(lineStart, closeIdx + 1);
console.log("Block to remove:", JSON.stringify(block));
console.log(
  "After block:",
  JSON.stringify(c.slice(closeIdx + 1, closeIdx + 20)),
);

c = c.slice(0, lineStart) + c.slice(closeIdx + 1);
fs.writeFileSync(
  "C:/Users/xyver/StudioProjects/sysu-go/app/build.gradle.kts",
  c,
);
console.log("Removed. devBuild still present:", c.includes("devBuild"));
