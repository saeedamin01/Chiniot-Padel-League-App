'use client'

import { useRef, useEffect, useState } from 'react'
import { MapPin, ChevronDown, Star } from 'lucide-react'
import type { Venue } from '@/types'

interface VenuePickerProps {
  venueList: Venue[]
  value: string
  onChange: (id: string) => void
  /** If true, shows a "Keep current / None" option at the top */
  allowEmpty?: boolean
  emptyLabel?: string
  placeholder?: string
}

export function VenuePicker({
  venueList,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = 'None',
  placeholder = 'Select a venue…',
}: VenuePickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const partners = venueList.filter(v => v.is_partner)
  const others   = venueList.filter(v => !v.is_partner)

  const selected = venueList.find(v => v.id === value) ?? null

  function pick(id: string) {
    onChange(id)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors
          ${open
            ? 'bg-slate-700 border-emerald-500/60 ring-1 ring-emerald-500/30'
            : 'bg-slate-700/60 border-slate-600/60 hover:border-slate-500'
          }`}
      >
        <MapPin className="w-4 h-4 text-slate-400 shrink-0" />

        {selected ? (
          <span className="flex-1 truncate text-white flex items-center gap-2">
            {selected.is_partner && (
              <Star className="w-3 h-3 text-emerald-400 shrink-0" />
            )}
            {selected.name}
            {selected.address && (
              <span className="text-slate-400 font-normal hidden sm:inline">· {selected.address}</span>
            )}
          </span>
        ) : (
          <span className="flex-1 text-slate-400">{allowEmpty && !value ? emptyLabel : placeholder}</span>
        )}

        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600/60 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto">

          {/* Empty option */}
          {allowEmpty && (
            <VenueRow
              id=""
              name={emptyLabel}
              selected={value === ''}
              onSelect={pick}
            />
          )}

          {/* Partner venues */}
          {partners.length > 0 && (
            <>
              <SectionHeader label="Partner Venues" />
              {partners.map(v => (
                <VenueRow
                  key={v.id}
                  id={v.id}
                  name={v.name}
                  address={v.address}
                  notes={v.notes}
                  isPartner
                  selected={value === v.id}
                  onSelect={pick}
                />
              ))}
            </>
          )}

          {/* Other venues */}
          {others.length > 0 && (
            <>
              {partners.length > 0 && <SectionHeader label="Other Venues" />}
              {others.map(v => (
                <VenueRow
                  key={v.id}
                  id={v.id}
                  name={v.name}
                  address={v.address}
                  notes={v.notes}
                  selected={value === v.id}
                  onSelect={pick}
                />
              ))}
            </>
          )}

          {venueList.length === 0 && !allowEmpty && (
            <p className="text-xs text-slate-500 text-center py-4 px-3">
              No venues configured — contact admin
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  const isPartner = label === 'Partner Venues'
  return (
    <div className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1.5 border-b
      ${isPartner
        ? 'text-emerald-400/80 border-emerald-500/20 bg-emerald-500/5'
        : 'text-slate-500 border-slate-700/60 bg-slate-800/80'
      }`}
    >
      {isPartner && <Star className="w-2.5 h-2.5" />}
      {label}
    </div>
  )
}

function VenueRow({
  id, name, address, notes, isPartner, selected, onSelect,
}: {
  id: string
  name: string
  address?: string
  notes?: string
  isPartner?: boolean
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors group
        ${selected
          ? 'bg-emerald-500/15 text-white'
          : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
        }`}
    >
      {/* Radio dot */}
      <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center
        ${selected ? 'border-emerald-500' : 'border-slate-600 group-hover:border-slate-400'}`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-medium truncate">{name || <span className="text-slate-400 font-normal italic">None</span>}</span>
          {isPartner && (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded
              bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              Partner
            </span>
          )}
        </div>
        {(address || notes) && (
          <div className="flex items-center gap-2 mt-0.5">
            {address && <span className="text-xs text-slate-500 truncate">{address}</span>}
            {notes && <span className="text-xs text-emerald-400/70 shrink-0">★ {notes}</span>}
          </div>
        )}
      </div>
    </button>
  )
}
