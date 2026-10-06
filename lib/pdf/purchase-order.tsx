import { readFileSync } from "node:fs";
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Branded Purchase Order PDF.
 * The logo is the OFFICIAL primary navy logo PNG (public/brand/logo-primary-navy.png,
 * 2462×2202), placed at its native aspect ratio — never redrawn or recoloured.
 */

const ROOT = process.cwd();
const FONT_DIR = path.join(ROOT, "assets", "fonts");
const LOGO_PATH = path.join(ROOT, "public", "brand", "logo-primary-navy.png");
const LOGO_RATIO = 2462 / 2202;

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({
    family: "Satoshi",
    fonts: [
      { src: path.join(FONT_DIR, "Satoshi-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "Satoshi-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "Satoshi-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({ family: "DM Serif Display", src: path.join(FONT_DIR, "DMSerifDisplay-Regular.ttf") });
  Font.registerHyphenationCallback((word) => [word]);
  fontsRegistered = true;
}

export interface PurchaseOrderPdfData {
  poNumber: string;
  requisitionNumber: string;
  issueDate: string; // display string
  church: { name: string; lines: string[] };
  vendor: { name: string | null; contact: string | null; email: string | null; phone: string | null; address: string | null; url: string | null };
  department: string;
  subcategory: string;
  requestType: string;
  requester: { name: string; email: string; phone: string };
  neededBy: string;
  costCenter: string | null;
  expenseCategory: string | null;
  items: { line: number; description: string; detail: string | null; quantity: string; unitPrice: string; lineTotal: string }[];
  total: string;
  approval: { approvedBy: string | null; approvedOn: string | null; issuedBy: string | null };
  notes: string | null;
  instructions: string;
  footer: string;
  isDemo: boolean;
}

const NAVY = "#12172D";
const GOLD = "#F3C94A";
const GRAY = "#EDF0F4";
const MUTED = "#5A5F70";

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 58, paddingHorizontal: 44, fontFamily: "Satoshi", fontSize: 9.5, color: NAVY },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontFamily: "DM Serif Display", fontSize: 24, textAlign: "right" },
  meta: { marginTop: 6, textAlign: "right", fontSize: 9.5, color: MUTED },
  metaStrong: { color: NAVY, fontWeight: 700 },
  rule: { marginTop: 10, marginBottom: 14, height: 3, width: 48, backgroundColor: GOLD },
  twoCol: { flexDirection: "row", marginBottom: 12 },
  boxLeft: { marginRight: 18 },
  box: { flexGrow: 1, flexShrink: 1, flexBasis: 0, justifyContent: "flex-start", borderWidth: 1, borderColor: GRAY, borderRadius: 6, padding: 9 },
  label: { fontSize: 7.5, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  strong: { fontWeight: 700 },
  line: { marginBottom: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderColor: GRAY, marginBottom: 12 },
  cell: { width: "33.33%", paddingVertical: 5, paddingRight: 8, borderBottomWidth: 1, borderColor: GRAY },
  tableHead: { flexDirection: "row", backgroundColor: NAVY, color: "#FFFFFF", paddingVertical: 6, paddingHorizontal: 6, fontWeight: 700, fontSize: 8.5 },
  row: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderColor: GRAY },
  rowAlt: { backgroundColor: "#F7F8FA" },
  cNo: { width: 22 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 50, textAlign: "right" },
  cPrice: { width: 72, textAlign: "right" },
  cTotal: { width: 78, textAlign: "right" },
  totalBar: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8 },
  totalBox: { backgroundColor: NAVY, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14, flexDirection: "row", alignItems: "center" },
  totalLabel: { color: "#FFFFFF", fontSize: 9, fontWeight: 500, marginRight: 18 },
  totalValue: { color: GOLD, fontFamily: "DM Serif Display", fontSize: 16 },
  section: { marginTop: 12 },
  callout: { borderLeftWidth: 3, borderColor: GOLD, backgroundColor: "#FDF6DE", padding: 8 },
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, borderTopWidth: 1, borderColor: GRAY, paddingTop: 8, fontSize: 7.5, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
  demo: { position: "absolute", top: 300, left: 120, fontSize: 64, color: "#EDF0F4", transform: "rotate(-30deg)", fontWeight: 700 },
});

function PurchaseOrderDocument({ d, logo }: { d: PurchaseOrderPdfData; logo: Buffer }) {
  const logoHeight = 54;
  const vendorLines = [d.vendor.contact, d.vendor.address, d.vendor.phone, d.vendor.email, d.vendor.url].filter(Boolean) as string[];
  const details: [string, string][] = [
    ["Department", `${d.department} · ${d.subcategory}`],
    ["Request type", d.requestType],
    ["Date needed", d.neededBy],
    ["Requester", d.requester.name],
    ["Requester email", d.requester.email],
    ["Requester phone", d.requester.phone],
    ["Budget line / cost center", d.costCenter ?? "—"],
    ["Expense category", d.expenseCategory ?? "—"],
    ["Requisition #", d.requisitionNumber],
  ];
  return (
    <Document title={`Purchase Order ${d.poNumber}`} author={d.church.name} subject={`Purchase Order ${d.poNumber}`} creator="The Kings Tribe Finance & Operations">
      <Page size="LETTER" style={s.page}>
        {d.isDemo ? <Text style={s.demo} fixed>DEMO — NOT VALID</Text> : null}
        <View style={s.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
          <Image src={{ data: logo, format: "png" }} style={{ height: logoHeight, width: logoHeight * LOGO_RATIO }} />
          <View>
            <Text style={s.title}>Purchase Order</Text>
            <Text style={s.meta}>
              PO number <Text style={s.metaStrong}>{d.poNumber}</Text>
              {"\n"}Issue date <Text style={s.metaStrong}>{d.issueDate}</Text>
              {"\n"}Requisition <Text style={s.metaStrong}>{d.requisitionNumber}</Text>
            </Text>
          </View>
        </View>
        <View style={s.rule} />

        <View style={s.twoCol}>
          <View style={[s.box, s.boxLeft]}>
            <Text style={s.label}>Issued by</Text>
            <Text style={[s.strong, s.line]}>{d.church.name}</Text>
            {d.church.lines.map((l) => <Text key={l} style={s.line}>{l}</Text>)}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Vendor</Text>
            <Text style={[s.strong, s.line]}>{d.vendor.name ?? "As listed per line item"}</Text>
            {vendorLines.map((l) => <Text key={l} style={s.line}>{l}</Text>)}
          </View>
        </View>

        <View style={s.grid}>
          {details.map(([k, v]) => (
            <View key={k} style={s.cell}>
              <Text style={s.label}>{k}</Text>
              <Text>{v}</Text>
            </View>
          ))}
        </View>

        <View style={s.tableHead} fixed>
          <Text style={s.cNo}>#</Text>
          <Text style={s.cDesc}>Approved item</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cPrice}>Unit price</Text>
          <Text style={s.cTotal}>Line total</Text>
        </View>
        {d.items.map((item, i) => (
          <View key={item.line} style={[s.row, i % 2 === 1 ? s.rowAlt : {}]} wrap={false}>
            <Text style={s.cNo}>{item.line}</Text>
            <View style={s.cDesc}>
              <Text style={s.strong}>{item.description}</Text>
              {item.detail ? <Text style={{ color: MUTED, marginTop: 2 }}>{item.detail}</Text> : null}
            </View>
            <Text style={s.cQty}>{item.quantity}</Text>
            <Text style={s.cPrice}>{item.unitPrice}</Text>
            <Text style={s.cTotal}>{item.lineTotal}</Text>
          </View>
        ))}
        <View style={s.totalBar}>
          <View style={s.totalBox}>
            <Text style={s.totalLabel}>PO total</Text>
            <Text style={s.totalValue}>{d.total}</Text>
          </View>
        </View>

        <View style={[s.twoCol, s.section]} wrap={false}>
          <View style={[s.box, s.boxLeft]}>
            <Text style={s.label}>Approval</Text>
            <Text style={s.line}>Approved by: {d.approval.approvedBy ?? "—"}</Text>
            <Text style={s.line}>Approved on: {d.approval.approvedOn ?? "—"}</Text>
            <Text style={s.line}>Issued by: {d.approval.issuedBy ?? "—"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Notes</Text>
            <Text style={s.line}>{d.notes || "—"}</Text>
          </View>
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.label}>Instructions</Text>
          <Text style={s.callout}>{d.instructions}</Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={{ flex: 1, marginRight: 12 }}>{d.footer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${d.poNumber} · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
  registerFonts();
  const logo = readFileSync(LOGO_PATH);
  return renderToBuffer(<PurchaseOrderDocument d={data} logo={logo} />);
}
