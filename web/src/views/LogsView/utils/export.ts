export function formatToISO8601WithOffset(timestampSec: number): string {
  const date = new Date(timestampSec * 1000);
  const tzo = -date.getTimezoneOffset();
  const dif = tzo >= 0 ? '+' : '-';
  const pad = (num: number) => String(num).padStart(2, '0');
  const padMs = (num: number) => String(num).padStart(3, '0');
  
  return date.getFullYear() +
    '-' + pad(date.getMonth() + 1) +
    '-' + pad(date.getDate()) +
    'T' + pad(date.getHours()) +
    ':' + pad(date.getMinutes()) +
    ':' + pad(date.getSeconds()) +
    '.' + padMs(date.getMilliseconds()) +
    (tzo === 0 ? 'Z' : (dif + pad(Math.floor(Math.abs(tzo) / 60)) + ':' + pad(Math.abs(tzo) % 60)));
}

export function generateCSV(logsData: any[]): string {
  const headers = [
    "profile_id",
    "access_point_id",
    "time",
    "client_ip",
    "geo_country",
    "domain",
    "record_type",
    "action",
    "reason",
    "answer",
    "dest_geoip",
    "ecs",
    "upstream",
    "latency"
  ];

  const csvRows = [headers.join(",")];
  
  for (const item of logsData) {
    const row = headers.map(header => {
      let val = "";
      if (header === "time") {
        val = formatToISO8601WithOffset(item.timestamp);
      } else {
        val = item[header] !== null && item[header] !== undefined ? String(item[header]) : "";
      }
      
      const escaped = val.replace(/"/g, '""');
      if (escaped.includes(",") || escaped.includes("\n") || escaped.includes("\r") || escaped.includes('"')) {
        return `"${escaped}"`;
      }
      return escaped;
    });
    csvRows.push(row.join(","));
  }
  return csvRows.join("\n");
}

export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildExportFilename(
  profileId: string,
  newestTimestamp: number,
  oldestTimestamp: number,
  params: URLSearchParams
): string {
  const endStr = formatToISO8601WithOffset(newestTimestamp);
  const startStr = formatToISO8601WithOffset(oldestTimestamp);
  const filterParamsStr = params.toString();
  return `query_logs_${profileId}_${endStr}_${startStr}_${filterParamsStr}.csv`;
}
