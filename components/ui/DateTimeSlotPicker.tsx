'use client'

/**
 * DateTimeSlotPicker — compact, Apple-style
 *
 * Single row: [date input] [‹ H › : ‹ MM › [AM|PM]]
 * Only :00 and :30 are reachable. No tall drum columns.
 * Emits / accepts "YYYY-MM-DDTHH:MM" (datetime-local format).
 */

import React, { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface DateTimeSlotPickerProps {
  value: string
  onChange: (value: string) => void
  minDate?: string
  maxDate?: string
  className?: string
  disabled?: boolean
}

const HOURS   = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']
const MINUTES = ['00', '30']
const AMPM    = ['AM', 'PM']

const DEFAULT_H = HOURS.indexOf('6')  // 6:00 AM default

/* ── helpers ── */

function parse24(t: string) {
  if (!t || t.length < 5) return { hI: DEFAULT_H, mI: 0, aI: 0 }
  const h24 = parseInt(t.slice(0, 2), 10)
  const mm   = t.slice(3, 5)
  const aI   = h24 < 12 ? 0 : 1
  const h12  = h24 % 12 === 0 ? 12 : h24 % 12
  const hI   = HOURS.indexOf(String(h12))
  const mI   = MINUTES.indexOf(mm) === -1 ? 0 : MINUTES.indexOf(mm)
  return { hI: hI === -1 ? DEFAULT_H : hI, mI, aI }
}

function build24(hI: number, mI: number, aI: number) {
  const h12 = parseInt(HOURS[hI], 10)
  const pm  = AMPM[aI] === 'PM'
  const h24 = pm ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12)
  return `${String(h24).padStart(2, '0')}:${MINUTES[mI]}`
}

/* ── Compact spinner: ‹ value › ── */

function Spinner({
  value, onPrev, onNext, disabled, width = 'w-7',
}: {
  value: string
  onPrev: () => void
  onNext: () => void
  disabled: boolean
  width?: string
}) {
  const btn =
    'flex items-center justify-center w-6 h-8 rounded ' +
    'text-slate-500 hover:text-white active:text-emerald-400 ' +
    'transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center select-none">
      <button type="button" className={btn} onClick={onPrev} disabled={disabled}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className={`${width} text-center font-semibold text-white text-sm tabular-nums`}>
        {value}
      </span>
      <button type="button" className={btn} onClick={onNext} disabled={disabled}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ── Main component ── */

export function DateTimeSlotPicker({
  value,
  onChange,
  minDate,
  maxDate,
  className = '',
  disabled = false,
}: DateTimeSlotPickerProps) {
  const { datePart, hI, mI, aI } = useMemo(() => {
    if (!value) return { datePart: '', hI: DEFAULT_H, mI: 0, aI: 0 }
    const tIdx = value.indexOf('T')
    if (tIdx === -1) return { datePart: value, hI: DEFAULT_H, mI: 0, aI: 0 }
    return { datePart: value.slice(0, tIdx), ...parse24(value.slice(tIdx + 1)) }
  }, [value])

  function emit(d: string, newHI: number, newMI: number, newAI: number) {
    onChange(d ? `${d}T${build24(newHI, newMI, newAI)}` : '')
  }

  function onDateChange(d: string) {
    if (!d) { onChange(''); return }
    emit(d, hI, mI, aI)
  }

  const prev = (arr: string[], i: number) => (i - 1 + arr.length) % arr.length
  const next = (arr: string[], i: number) => (i + 1) % arr.length

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Date */}
      <input
        type="date"
        value={datePart}
        min={minDate}
        max={maxDate}
        disabled={disabled}
        onChange={e => onDateChange(e.target.value)}
        lang="en-GB"
        className={
          'flex-1 min-w-0 bg-slate-700 border border-slate-600 rounded-lg px-3 ' +
          'text-white text-sm focus:outline-none focus:border-emerald-500 h-10 ' +
          'disabled:opacity-50'
        }
      />

      {/* Time — only visible once a date is chosen */}
      {datePart ? (
        <div className="flex items-center shrink-0 h-10 bg-slate-800 border border-slate-600 rounded-lg px-1 gap-0">
          {/* Hour */}
          <Spinner
            value={HOURS[hI]}
            onPrev={() => emit(datePart, prev(HOURS, hI), mI, aI)}
            onNext={() => emit(datePart, next(HOURS, hI), mI, aI)}
            disabled={disabled}
            width="w-7"
          />

          <span className="text-slate-500 font-bold text-sm select-none -mx-0.5">:</span>

          {/* Minutes */}
          <Spinner
            value={MINUTES[mI]}
            onPrev={() => emit(datePart, hI, prev(MINUTES, mI), aI)}
            onNext={() => emit(datePart, hI, next(MINUTES, mI), aI)}
            disabled={disabled}
            width="w-7"
          />

          {/* AM / PM toggle */}
          <button
            type="button"
            onClick={() => emit(datePart, hI, mI, aI === 0 ? 1 : 0)}
            disabled={disabled}
            className={
              'ml-1 px-2 h-7 rounded text-xs font-semibold transition-colors select-none ' +
              'disabled:opacity-30 disabled:cursor-not-allowed ' +
              (aI === 0
                ? 'bg-sky-500/20 text-sky-300 hover:bg-sky-500/30'
                : 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30')
            }
          >
            {AMPM[aI]}
          </button>
        </div>
      ) : (
        /* Placeholder so the row height stays consistent before a date is picked */
        <div className="shrink-0 h-10 w-36 bg-slate-800/50 border border-slate-700 rounded-lg flex items-center justify-center">
          <span className="text-slate-600 text-xs select-none">pick date first</span>
        </div>
      )}
    </div>
  )
}
