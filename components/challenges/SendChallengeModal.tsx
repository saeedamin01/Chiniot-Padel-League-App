'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { X, Clock, MapPin } from 'lucide-react'
import { DateTimeSlotPicker } from '@/components/ui/DateTimeSlotPicker'

export interface Team {
  id: string
  name: string
  rank: number
}

interface TimeSlot {
  id: string
  dateTime: string
}

interface SendChallengeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  eligibleTeams: Team[]
  onSubmit: (data: {
    targetTeamId: string
    timeSlots: string[]
    location?: string
    ticketId?: string
  }) => Promise<void>
  isLoading?: boolean
}

export function SendChallengeModal({
  open,
  onOpenChange,
  eligibleTeams,
  onSubmit,
  isLoading = false,
}: SendChallengeModalProps) {
  const [selectedTeam, setSelectedTeam] = useState<string>('')
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
    { id: '1', dateTime: '' },
    { id: '2', dateTime: '' },
    { id: '3', dateTime: '' },
  ])
  const [location, setLocation] = useState('')
  const [ticketId, setTicketId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!selectedTeam) {
      newErrors.team = 'Please select a target team'
    }

    // A valid slot has both a date AND a time selected (value looks like "YYYY-MM-DDTHH:MM")
    const filledSlots = timeSlots.filter((slot) => {
      const v = slot.dateTime.trim()
      const [d, t] = v.split('T')
      return d && t && t.length === 5
    })
    if (filledSlots.length === 0) {
      newErrors.timeSlots = 'Please offer at least one time slot'
    } else {
      const values = filledSlots.map(s => s.dateTime)
      if (new Set(values).size < values.length) {
        newErrors.timeSlots = 'Each slot must be a different date/time — remove the duplicate'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

    try {
      const validSlots = timeSlots
        .filter((slot) => slot.dateTime.trim() !== '')
        .map((slot) => slot.dateTime)

      await onSubmit({
        targetTeamId: selectedTeam,
        timeSlots: validSlots,
        location: location || undefined,
        ticketId: ticketId || undefined,
      })

      // Reset form
      setSelectedTeam('')
      setTimeSlots([
        { id: '1', dateTime: '' },
        { id: '2', dateTime: '' },
        { id: '3', dateTime: '' },
      ])
      setLocation('')
      setTicketId('')
      setErrors({})
    } catch (error) {
      console.error('Failed to send challenge:', error)
    }
  }

  const handleSlotChange = (id: string, value: string) => {
    const updated = timeSlots.map((slot) =>
      slot.id === id ? { ...slot, dateTime: value } : slot
    )
    setTimeSlots(updated)

    // Instant duplicate feedback
    if (value.trim()) {
      const otherValues = updated
        .filter(s => s.id !== id && s.dateTime.trim() !== '')
        .map(s => s.dateTime)
      if (otherValues.includes(value)) {
        setErrors(e => ({ ...e, timeSlots: 'Each slot must be a different date/time — remove the duplicate' }))
        return
      }
    }
    // Clear error once resolved
    if (errors.timeSlots) setErrors(e => ({ ...e, timeSlots: '' }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send Challenge</DialogTitle>
          <DialogDescription>
            Challenge a team ranked up to 3 positions above you
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Target Team Selection */}
          <div className="space-y-2">
            <Label htmlFor="team">Target Team</Label>
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger id="team">
                <SelectValue placeholder="Select a team to challenge" />
              </SelectTrigger>
              <SelectContent>
                {eligibleTeams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name} (Rank #{team.rank})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.team && (
              <p className="text-sm text-red-400">{errors.team}</p>
            )}
          </div>

          {/* Time Slots */}
          <div className="space-y-3">
            <Label>Offer Time Slots (at least 1)</Label>
            <div className="space-y-2">
              {timeSlots.map((slot, index) => (
                <div key={slot.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-12 shrink-0">Slot {index + 1}</span>
                  <DateTimeSlotPicker
                    value={slot.dateTime}
                    onChange={(v) => handleSlotChange(slot.id, v)}
                    className="flex-1"
                  />
                </div>
              ))}
            </div>
            {errors.timeSlots && (
              <p className="text-sm text-red-400">{errors.timeSlots}</p>
            )}
          </div>

          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="location">Match Location (Optional)</Label>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-500" />
              <Input
                id="location"
                placeholder="e.g., Court 1, Sports Complex"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          {/* Ticket Information */}
          <div className="space-y-2">
            <Label htmlFor="ticket">Ticket ID (Optional)</Label>
            <Input
              id="ticket"
              placeholder="If you have a support ticket"
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
            />
          </div>

          {/* Summary */}
          {selectedTeam && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-slate-100 mb-2">Summary</h3>
                <ul className="space-y-1 text-sm text-slate-300">
                  <li>
                    Target:{' '}
                    <span className="font-semibold">
                      {eligibleTeams.find((t) => t.id === selectedTeam)?.name}
                    </span>
                  </li>
                  <li>
                    Time Slots:{' '}
                    <span className="font-semibold">
                      {timeSlots.filter((s) => s.dateTime).length} offered
                    </span>
                  </li>
                  {location && (
                    <li>
                      Location:{' '}
                      <span className="font-semibold">{location}</span>
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? 'Sending...' : 'Send Challenge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
