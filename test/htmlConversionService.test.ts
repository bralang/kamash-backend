import { describe, it, expect } from "vitest";

import { buildPersonalDetailsHtml } from "../src/services/htmlConversionService.js";

const fullPatient = { name: "ילד א", age: "8", school: "בית ספר הגפן", grade: "ג", city: "בני ברק", date: "2026-02-20" };

describe("buildPersonalDetailsHtml", () => {
  it("renders all fields with Hebrew labels in the fixed order, inside the standard section wrapper", () => {
    const html = buildPersonalDetailsHtml(fullPatient);

    expect(html).toContain('<section class="diagnosis-section" data-section="פרטים אישיים">');
    expect(html).toContain("<h2>פרטים אישיים</h2>");
    expect(html).toContain("<p><strong>שם:</strong> ילד א</p>");
    expect(html).toContain("<p><strong>גיל:</strong> 8</p>");
    expect(html).toContain("<p><strong>מקום לימודים:</strong> בית ספר הגפן</p>");
    expect(html).toContain("<p><strong>כיתה:</strong> ג</p>");
    expect(html).toContain("<p><strong>עיר מגורים:</strong> בני ברק</p>");
    expect(html).toContain("<p><strong>תאריך אבחון:</strong> 2026-02-20</p>");
    expect(html.trimEnd().endsWith("</section>")).toBe(true);

    const order = ["שם", "גיל", "מקום לימודים", "כיתה", "עיר מגורים", "תאריך אבחון"].map((label) =>
      html.indexOf(`<strong>${label}:</strong>`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((idx) => idx >= 0)).toBe(true);
  });

  it("omits rows for empty or whitespace-only fields", () => {
    const html = buildPersonalDetailsHtml({ ...fullPatient, school: "", city: "   " });

    expect(html).not.toContain("מקום לימודים");
    expect(html).not.toContain("עיר מגורים");
    expect(html).toContain("<p><strong>שם:</strong> ילד א</p>");
    expect(html).toContain("<p><strong>תאריך אבחון:</strong> 2026-02-20</p>");
  });

  it("escapes HTML-significant characters in field values", () => {
    const html = buildPersonalDetailsHtml({ ...fullPatient, name: "<script>alert(1)</script>", school: "בי\"ס א & ב" });

    expect(html).not.toContain("<script>");
    expect(html).toContain("<p><strong>שם:</strong> &lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(html).toContain("<p><strong>מקום לימודים:</strong> בי&quot;ס א &amp; ב</p>");
  });
});
