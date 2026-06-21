import { t } from "i18next";

/**
 * A list of timezone options for user selection, including an auto-detect option.
 * Each option includes a label for display and a value corresponding to the IANA timezone identifier.
 */
export const timezoneOptions = [
  { label: t("account.timezoneAuto", "Auto (Browser Default)"), value: "" },
  {
    label: "Pacific/Midway (Midway Island) (Standard: UTC-11)",
    value: "Pacific/Midway",
  },
  {
    label: "Pacific/Honolulu (Honolulu, Hawaii) (Standard: UTC-10)",
    value: "Pacific/Honolulu",
  },
  {
    label:
      "America/Anchorage (Anchorage, Alaska) (Standard: UTC-9 / DST: UTC-8)",
    value: "America/Anchorage",
  },
  {
    label:
      "America/Los_Angeles (Pacific Time) (Standard: UTC-8 / DST: UTC-7)",
    value: "America/Los_Angeles",
  },
  {
    label: "America/Denver (Mountain Time) (Standard: UTC-7 / DST: UTC-6)",
    value: "America/Denver",
  },
  {
    label: "America/Chicago (Central Time) (Standard: UTC-6 / DST: UTC-5)",
    value: "America/Chicago",
  },
  {
    label: "America/New_York (Eastern Time) (Standard: UTC-5 / DST: UTC-4)",
    value: "America/New_York",
  },
  {
    label: "America/Halifax (Atlantic Time) (Standard: UTC-4 / DST: UTC-3)",
    value: "America/Halifax",
  },
  {
    label: "America/Argentina/Buenos_Aires (Buenos Aires) (Standard: UTC-3)",
    value: "America/Argentina/Buenos_Aires",
  },
  {
    label: "America/Noronha (Fernando de Noronha) (Standard: UTC-2)",
    value: "America/Noronha",
  },
  {
    label: "Atlantic/Azores (Azores) (Standard: UTC-1 / DST: UTC+0)",
    value: "Atlantic/Azores",
  },
  {
    label: "UTC (Coordinated Universal Time) (Standard: UTC+0)",
    value: "UTC",
  },
  {
    label: "Europe/London (London) (Standard: UTC+0 / DST: UTC+1)",
    value: "Europe/London",
  },
  {
    label:
      "Europe/Paris (Paris, Berlin, Rome) (Standard: UTC+1 / DST: UTC+2)",
    value: "Europe/Paris",
  },
  {
    label:
      "Europe/Kyiv (Kyiv, Helsinki, Cairo) (Standard: UTC+2 / DST: UTC+3)",
    value: "Europe/Kyiv",
  },
  {
    label: "Europe/Moscow (Moscow) (Standard: UTC+3)",
    value: "Europe/Moscow",
  },
  {
    label: "Asia/Dubai (Dubai, Baku) (Standard: UTC+4)",
    value: "Asia/Dubai",
  },
  {
    label: "Asia/Karachi (Karachi, Tashkent) (Standard: UTC+5)",
    value: "Asia/Karachi",
  },
  {
    label: "Asia/Dhaka (Dhaka, Almaty) (Standard: UTC+6)",
    value: "Asia/Dhaka",
  },
  {
    label: "Asia/Bangkok (Bangkok, Jakarta) (Standard: UTC+7)",
    value: "Asia/Bangkok",
  },
  {
    label:
      "Asia/Singapore (Beijing, Shanghai, Singapore, Taipei) (Standard: UTC+8)",
    value: "Asia/Singapore",
  },
  {
    label: "Asia/Tokyo (Tokyo, Seoul) (Standard: UTC+9)",
    value: "Asia/Tokyo",
  },
  {
    label:
      "Australia/Sydney (Sydney, Melbourne) (Standard: UTC+10 / DST: UTC+11)",
    value: "Australia/Sydney",
  },
  {
    label: "Pacific/Noumea (Nouméa) (Standard: UTC+11)",
    value: "Pacific/Noumea",
  },
  {
    label:
      "Pacific/Auckland (Auckland, Suva) (Standard: UTC+12 / DST: UTC+13)",
    value: "Pacific/Auckland",
  },
];
