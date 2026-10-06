/**
 * Prints the value for the "סיסמה מוצפנת" column of the "משתמשים" sheet.
 *
 *   npm run hash-password
 *
 * Reads the password from the terminal without echoing it (or from stdin when piped), so
 * it never lands in shell history. Needs no .env and no Google access.
 */
import { createInterface } from "node:readline";
import { hashPassword } from "../src/lib/password.js";

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (process.stdin.isTTY) {
      // Suppress echo of the typed characters; the prompt itself is still printed.
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      process.stdout.write(prompt);
      out._writeToOutput = () => {};
    }
    rl.question(process.stdin.isTTY ? "" : prompt, (answer) => {
      rl.close();
      if (process.stdin.isTTY) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const password = await readHidden("סיסמה: ");
if (password.length < 10) {
  console.error("הסיסמה קצרה מדי — לפחות 10 תווים.");
  process.exit(1);
}
if (process.stdin.isTTY && (await readHidden("שוב: ")) !== password) {
  console.error("הסיסמאות אינן תואמות.");
  process.exit(1);
}
console.log(await hashPassword(password));
