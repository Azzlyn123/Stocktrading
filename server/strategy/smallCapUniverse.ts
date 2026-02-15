import { type SmallCapGapperEvent } from "../historicalSimulator";

export const SMALLCAP_SCAN_TICKERS = [
  "FFIE", "MULN", "SOUN", "BBAI", "GSAT", "DNA", "ASTS", "AFRM",
  "RKLB", "IONQ", "SMCI", "RGTI", "KULR", "QUBT", "BTBT", "MARA",
  "RIOT", "CLSK", "BITF", "HUT", "WULF", "IREN", "CIFR", "CORZ",
  "SOFI", "PLTR", "HOOD", "GRAB", "NU", "LC", "UPST", "AEHR",
  "GEVO", "PLUG", "FCEL", "BLNK", "CHPT", "QS", "MVST", "GOEV",
  "VFS", "LCID", "RIVN", "NIO", "XPEV", "LI", "PSNY", "FSR",
  "OPEN", "CLOV", "WISH", "SDC", "SKLZ", "IRNT", "SPIR", "ME",
  "APGE", "IQ", "FUBO", "CANO", "TLRY", "ACB", "CGC", "SNDL",
  "OGI", "HEXO", "GRPN", "PRCH", "LMND", "BFLY", "FIGS", "HIMS",
  "NKLA", "WKHS", "JOBY", "LILM", "ACHR", "EVTL", "BLDE", "ARQQ",
  "DM", "VNET", "MNDY", "CELH", "PRTS", "DAVE", "COUR", "DUOL",
  "DOCS", "TASK", "BRZE", "GLOB", "CRDO", "ALAB", "VRT", "APP",
];

export function buildScanDatesRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  const current = new Date(start);

  while (current <= end) {
    const dow = current.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(current.toISOString().slice(0, 10));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export const SMALLCAP_VALIDATION_DATES = buildScanDatesRange("2025-11-01", "2026-02-14");
