import { describe, expect, it } from "vitest";
import { POST as operations } from "../app/api/mobile/v1/operations/route";
import { POST as bill } from "../app/api/mobile/v1/bill/route";
import { POST as upload } from "../app/api/mobile/v1/upload/route";
import { GET as home } from "../app/api/mobile/v1/home/route";
import { GET as profile } from "../app/api/mobile/v1/profile/route";
describe("mobile actions authentication", () => {
  for (const [name, handler] of Object.entries({
    operations,
    bill,
    upload,
    home,
    profile,
  })) {
    it(
      name +
        " refuses requests without a session before reading or writing data",
      async () => {
        const response = await handler(
          new Request("https://ops.example.test/api/mobile/v1/" + name),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
      },
    );
  }
});
