"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { countryCallingCodes, defaultCountryCallingCode, splitPhoneNumber } from "../lib/country-calling-codes";

type PhoneNumberInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  inputClassName: string;
};

const countryOptions = [
  countryCallingCodes.find(([country]) => country === "Romania")!,
  ...countryCallingCodes.filter(([country]) => country !== "Romania"),
];

const countryAliases: Record<string, string> = {
  "Antigua and Barbuda": "AG", "Bosnia and Herzegovina": "BA", "Cabo Verde": "CV", "Congo, Democratic Republic": "CD", "Congo, Republic": "CG", "Côte d’Ivoire": "CI", "Czechia": "CZ", "Eswatini": "SZ", "Laos": "LA", "Micronesia": "FM", "Moldova": "MD", "North Korea": "KP", "Palestine": "PS", "Russia": "RU", "South Korea": "KR", "Syria": "SY", "Taiwan": "TW", "Tanzania": "TZ", "Türkiye": "TR", "United States": "US", "Vatican City": "VA", "Venezuela": "VE", "Vietnam": "VN",
};
const normalizeCountryName = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLocaleLowerCase();
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const regionByName = new Map<string, string>();
for (let first = 65; first <= 90; first += 1) for (let second = 65; second <= 90; second += 1) {
  const region = String.fromCharCode(first, second);
  const name = regionNames.of(region);
  if (name && name !== region) regionByName.set(normalizeCountryName(name), region);
}
function flagForCountry(country: string) {
  const region = countryAliases[country] ?? regionByName.get(normalizeCountryName(country));
  return region ? String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0))) : "🌐";
}

export default function PhoneNumberInput({ value, onChange, onBlur, disabled = false, inputClassName }: PhoneNumberInputProps) {
  const [parts, setParts] = useState(() => splitPhoneNumber(value));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const picker = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  const save = (code: string, number: string) => {
    const localNumber = number.trim().replace(/[\s()-]/g, "");
    const normalizedLocalNumber = code === defaultCountryCallingCode ? localNumber.replace(/^0/, "") : localNumber;
    onChange(normalizedLocalNumber ? `+${code.replace(/-/g, "")}${normalizedLocalNumber}` : "");
  };

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => { if (!picker.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setPickerOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);
  const selectedCountry = countryOptions.find(([, code]) => code === parts.code) ?? countryOptions[0];
  const searchTerm = search.trim().toLocaleLowerCase().replace(/^\+/, "");
  const matchingCountries = countryOptions.filter(([country, code]) => !searchTerm || country.toLocaleLowerCase().includes(searchTerm) || code.replace(/-/g, "").startsWith(searchTerm));
  const portalTarget = picker.current?.closest("dialog") ?? (typeof document === "undefined" ? null : document.body);

  const openPicker = () => {
    const bounds = picker.current?.getBoundingClientRect();
    if (bounds) {
      const menuHeight = 330;
      const top = window.innerHeight - bounds.bottom < menuHeight ? Math.max(8, bounds.top - menuHeight - 4) : bounds.bottom + 4;
      setMenuPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 296)), top });
    }
    setPickerOpen(true); setSearch("");
  };

  return <span className="flex min-w-0 gap-2">
    <span ref={picker} className="relative w-32 shrink-0">
      <button type="button" aria-label="Phone country code" aria-expanded={pickerOpen} aria-haspopup="listbox" disabled={disabled} onClick={() => { if (pickerOpen) setPickerOpen(false); else openPicker(); }} className="flex w-full items-center justify-between gap-1 rounded-md border border-stone-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600 disabled:bg-stone-50 disabled:text-slate-500"><span className="min-w-0 truncate">{flagForCountry(selectedCountry[0])} +{parts.code}</span><span aria-hidden="true" className="text-slate-400">⌄</span></button>
    </span>
    <input aria-label="Phone number" disabled={disabled} type="tel" inputMode="tel" autoComplete="tel-national" value={parts.number} onChange={(event) => { const number = event.target.value; setParts((current) => ({ ...current, number })); save(parts.code, number); }} onBlur={onBlur} className={inputClassName} />
    {pickerOpen && portalTarget && createPortal(<span ref={menu} className="fixed z-[60] block w-72 overflow-hidden rounded-lg border border-stone-200 bg-white p-2 shadow-lg" style={{ left: menuPosition.left, top: menuPosition.top }}><input autoFocus aria-label="Search country or calling code" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search country or code" className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600" /><span role="listbox" aria-label="Countries" className="mt-2 block max-h-56 overflow-y-auto">{matchingCountries.length ? matchingCountries.map(([country, code]) => <button key={`${country}-${code}`} type="button" role="option" aria-selected={parts.code === code} onClick={() => { setParts((current) => ({ ...current, code })); save(code, parts.number); setPickerOpen(false); setSearch(""); }} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-lime-50 focus:bg-lime-50 focus:outline-none ${parts.code === code ? "bg-lime-100 text-lime-900" : "text-slate-700"}`}><span className="text-base">{flagForCountry(country)}</span><span className="min-w-0 flex-1 truncate">{country}</span><span className="text-slate-500">+{code}</span></button>) : <span className="block px-2 py-3 text-sm text-slate-500">No countries found.</span>}</span></span>, portalTarget)}
  </span>;
}
