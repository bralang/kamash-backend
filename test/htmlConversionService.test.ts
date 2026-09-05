import { describe, it, expect } from "vitest";

import {
  buildPersonalDetailsHtml,
  formatDiagnosisDate,
  stripGroupHeadingMarkers,
  stripRedundantSubheadings,
} from "../src/services/htmlConversionService.js";

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
    expect(html).toContain("<p><strong>תאריך אבחון:</strong> 20/02/2026</p>");
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
    expect(html).toContain("<p><strong>תאריך אבחון:</strong> 20/02/2026</p>");
  });

  it("escapes HTML-significant characters in field values", () => {
    const html = buildPersonalDetailsHtml({ ...fullPatient, name: "<script>alert(1)</script>", school: "בי\"ס א & ב" });

    expect(html).not.toContain("<script>");
    expect(html).toContain("<p><strong>שם:</strong> &lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(html).toContain("<p><strong>מקום לימודים:</strong> בי&quot;ס א &amp; ב</p>");
  });
});

describe("formatDiagnosisDate", () => {
  it("renders the intake form's ISO date as the clinic's DD/MM/YYYY", () => {
    expect(formatDiagnosisDate("2026-08-19")).toBe("19/08/2026");
    expect(formatDiagnosisDate("2026-02-20")).toBe("20/02/2026");
    expect(formatDiagnosisDate(" 2026-08-19 ")).toBe("19/08/2026");
  });

  it("passes through anything that is not exactly an ISO date rather than guessing", () => {
    expect(formatDiagnosisDate("19/08/2026")).toBe("19/08/2026");
    expect(formatDiagnosisDate("19.08.2026")).toBe("19.08.2026");
    expect(formatDiagnosisDate("2026-8-9")).toBe("2026-8-9");
    expect(formatDiagnosisDate("")).toBe("");
  });

  it("leaves the date row out entirely when the intake field is blank", () => {
    const html = buildPersonalDetailsHtml({ ...fullPatient, date: "" });
    expect(html).not.toContain("תאריך אבחון");
  });
});

describe("stripRedundantSubheadings", () => {
  // Verbatim from the two real diagnoses we compared: both produced an "המלצות" h3 directly
  // under the "המלצות לטיפולים חיצוניים" h2, and the clinic deleted it by hand both times.
  it("removes a sub-heading the section title already contains word-for-word", () => {
    const html = [
      '<section class="diagnosis-section" data-section="המלצות לטיפולים חיצוניים">',
      "  <h2>המלצות לטיפולים חיצוניים</h2>",
      "  <h3>המלצות</h3>",
      "  <ul>",
      "    <li>בדיקת נוירולוג.</li>",
      "  </ul>",
      "</section>",
    ].join("\n");

    const out = stripRedundantSubheadings(html, "המלצות לטיפולים חיצוניים");

    expect(out).not.toContain("<h3>המלצות</h3>");
    expect(out).toContain("<h2>המלצות לטיפולים חיצוניים</h2>");
    expect(out).toContain("<li>בדיקת נוירולוג.</li>");
  });

  it("keeps a real sub-heading that merely shares a word with the section title", () => {
    const html = "<h2>המלצות לעבודה בבית</h2>\n<h3>המלצות להתערבות</h3>\n<p>תרגול יומיומי.</p>";

    expect(stripRedundantSubheadings(html, "המלצות לעבודה בבית")).toContain("<h3>המלצות להתערבות</h3>");
  });

  it("leaves a paraphrase of the section title for a human to judge", () => {
    // "סיכום קשיים שנצפו באבחון" under "הקשיים שנצפו" is redundant in substance, but matching
    // it would need fuzzy comparison — too blunt a tool to point at clinical headings.
    const html = "<h2>הקשיים שנצפו</h2>\n<h3>סיכום קשיים שנצפו באבחון</h3>";

    expect(stripRedundantSubheadings(html, "הקשיים שנצפו")).toContain("<h3>סיכום קשיים שנצפו באבחון</h3>");
  });

  it("ignores the h2 itself and strips empty headings at both levels", () => {
    const html = "<h2>יעדים</h2>\n<h3></h3>\n<h4>   </h4>\n<h3>מטרות היעד:</h3>";

    const out = stripRedundantSubheadings(html, "יעדים");

    expect(out).toContain("<h2>יעדים</h2>");
    expect(out).toContain("<h3>מטרות היעד:</h3>");
    expect(out).not.toContain("<h3></h3>");
    expect(out).not.toContain("<h4>   </h4>");
  });

  it("matches through markup, entities and Hebrew gershayim", () => {
    const withMarkup = '<h2>הגברת שטף בשיטת קמ"ש</h2>\n<h3><strong>הגברת&nbsp;שטף</strong></h3>';
    expect(stripRedundantSubheadings(withMarkup, 'הגברת שטף בשיטת קמ"ש')).not.toContain("<h3>");

    const withGershayim = "<h2>שיטת קמ״ש</h2>\n<h3>קמ״ש</h3>";
    expect(stripRedundantSubheadings(withGershayim, 'שיטת קמ"ש')).not.toContain("<h3>");
  });

  it("runs on section HTML that still carries group markers without tripping over them", () => {
    const html = "<h2>תוכנית עבודה למורה</h2>\n<h3>## קריאה</h3>\n<h4>חיזוק הערוץ החזותי</h4>";

    expect(stripRedundantSubheadings(html, "תוכנית עבודה למורה")).toBe(html);
  });

  it("leaves table cells and list items untouched, empty ones included", () => {
    // The findings table legitimately ships an empty "פירוט הקושי" cell; dropping it would
    // shift every following column.
    const html = "<h2>ממצאי האבחון</h2>\n<table><tbody><tr><td>שיום אותיות</td><td></td></tr></tbody></table>";

    expect(stripRedundantSubheadings(html, "ממצאי האבחון")).toBe(html);
  });
});

describe("stripGroupHeadingMarkers", () => {
  // Rule 10א asks the model to consume the "##" prefix, but a prompt is a request, not a
  // guarantee — this is the guard that keeps a leaked marker out of the clinic's document.
  it("removes a leaked marker from headings at every level", () => {
    const html = [
      "<h2>## תוכנית עבודה למורה</h2>",
      "<h3>## קריאה</h3>",
      "<h4>##חיזוק הערוץ החזותי</h4>",
    ].join("\n");

    expect(stripGroupHeadingMarkers(html)).toBe(
      ["<h2>תוכנית עבודה למורה</h2>", "<h3>קריאה</h3>", "<h4>חיזוק הערוץ החזותי</h4>"].join("\n"),
    );
  });

  it("leaves unmarked headings, their attributes and their inner markup alone", () => {
    const html = '<h3 class="x">קריאה</h3>\n<h4><strong>הקניית התנועות</strong></h4>';

    expect(stripGroupHeadingMarkers(html)).toBe(html);
  });

  it("does not strip ## from body text, only from headings", () => {
    const html = "<h3>## קריאה</h3>\n<p>## אינו סימון בתוך פסקה</p>";

    const out = stripGroupHeadingMarkers(html);
    expect(out).toContain("<h3>קריאה</h3>");
    expect(out).toContain("<p>## אינו סימון בתוך פסקה</p>");
  });
});
