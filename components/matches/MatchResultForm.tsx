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
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'

export interface MatchResultFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  challengerName: string
  challengedName: string
  onSubmit: (data: {
    set1Challenger: number
    set1Challenged: number
    set2Challenger: number
    set2Challenged: number
    superTiebreakChallenger?: number
    superTiebreakChallenged?: number
    matchDate: string
    matchLocation: string
  }) => Promise<void>
  isLoading?: boolean
}

export function MatchResultForm({
  open,
  onOpenChange,
  challengerName,
  challengedName,
  onSubmit,
  isLoading = false,
}: MatchResultFormProps) {
  const [set1Challenger, setSet1Challenger] = useState('')
  const [set1Challenged, setSet1Challenged] = useState('')
  const [set2Challenger, setSet2Challenger] = useState('')
  const [set2Challenged, setSet2Challenged] = useState('')
  const [superTiebreakChallenger, setSuperTiebreakChallenger] = useState('')
  const [superTiebreakChallenged, setSuperTiebreakChallenged] = useState('')
  const [matchDate, setMatchDate] = useState('')
  const [matchLocation, setMatchLocation] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const needsSuperTiebreak =
    (set1Challenger !== '' && set1Challenged !== '' && set1Challenger === set1Challenged) ||
    (set2Challenger !== '' && set2Challenged !== '' && set2Challenger === set2Challenged)

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (set1Challenger === '' || set1Challenged === '') {
      newErrors.set1 = 'Set 1 scores are required'
    }
    if (set2Challenger === '' || set2Challenged === '') {
      newErrors.set2 = 'Set 2 scores are required'
    }

    if (needsSuperTiebreak) {
      if (superTiebreakChallenger === '' || superTiebreakChallenged === '') {
        newErrors.superTiebreak = 'Super tiebreak is required for tied sets'
      }
    }

    if (!matchDate) {
      newErrors.date = 'Match date is required'
    }
    if (!matchLocation) {
      newErrors.location = 'Match location is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validateForm()) return

    try {
      await onSubmit({
        set1Challenger: parseInt(set1Challenger),
        set1Challenged: parseInt(set1Challenged),
        set2Challenger: parseInt(set2Challenger),
        set2Challenged: parseInt(set2Challenged),
        superTiebreakChallenger: needsSuperTiebreak ? parseInt(superTiebreakChallenger) : undefined,
        superTiebreakChallenged: needsSuperTiebreak ? parseInt(superTiebreakChallenged) : undefined,
        matchDate,
        matchLocation,
      })

      // Reset form
      setSet1Challenger('')
      setSet1Challenged('')
      setSet2Challenger('')
      setSet2Challenged('')
      setSuperTiebreakChallenger('')
      setSuperTiebreakChallenged('')
      setMatchDate('')
      setMatchLocation('')
      setErrors({})
    } catch (error) {
      console.error('Failed to submit match result:', error)
    }
  }

  const isChallengerWinning =
    parseInt(set1Challenger) > parseInt(set1Challenged) ||
    parseInt(set2Challenger) > parseInt(set2Challenged) ||
    (needsSuperTiebreak && parseInt(superTiebreakChallenger) > parseInt(superTiebreakChallenged))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Report Match Result</DialogTitle>
          <DialogDescription>
            Enter the match scores and details
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Set 1 */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Set 1</Label>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div>
                <Label htmlFor="s1c" className="text-sm">{challengerName}</Label>
                <Input
                  id="s1c"
                  type="number"
                  min="0"
                  value={set1Challenger}
                  onChange={(e) => setSet1Challenger(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div className="text-center text-slate-500">—</div>
              <div>
                <Label htmlFor="s1d" className="text-sm">{challengedName}</Label>
                <Input
                  id="s1d"
                  type="number"
                  min="0"
                  value={set1Challenged}
                  onChange={(e) => setSet1Challenged(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>
            {errors.set1 && (
              <p className="text-sm text-red-400">{errors.set1}</p>
            )}
          </div>

          {/* Set 2 */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Set 2</Label>
            <div className="grid grid-cols-3 gap-3 items-end">
              <div>
                <Label htmlFor="s2c" className="text-sm">{challengerName}</Label>
                <Input
                  id="s2c"
                  type="number"
                  min="0"
                  value={set2Challenger}
                  onChange={(e) => setSet2Challenger(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div className="text-center text-slate-500">—</div>
              <div>
                <Label htmlFor="s2d" className="text-sm">{challengedName}</Label>
                <Input
                  id="s2d"
                  type="number"
                  min="0"
                  value={set2Challenged}
                  onChange={(e) => setSet2Challenged(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
            </div>
            {errors.set2 && (
              <p className="text-sm text-red-400">{errors.set2}</p>
            )}
          </div>

          {/* Super Tiebreak */}
          {needsSuperTiebreak && (
            <div className="space-y-3 p-4 bg-slate-800/50 rounded-lg border border-amber-500/30">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <Label className="text-base font-semibold text-amber-400">
                  Super Tiebreak (First to 10)
                </Label>
              </div>
              <div className="grid grid-cols-3 gap-3 items-end">
                <div>
                  <Label htmlFor="stc" className="text-sm">{challengerName}</Label>
                  <Input
                    id="stc"
                    type="number"
                    min="0"
                    value={superTiebreakChallenger}
                    onChange={(e) => setSuperTiebreakChallenger(e.target.value)}
                    placeholder="0"
                    className="mt-1"
                  />
                </div>
                <div className="text-center text-slate-500">—</div>
                <div>
                  <Label htmlFor="std" className="text-sm">{challengedName}</Label>
                  <Input
                    id="std"
                    type="number"
                    min="0"
                    value={superTiebreakChallenged}
                    onChange={(e) => setSuperTiebreakChallenged(e.target.value)}
                    placeholder="0"
                    className="mt-1"
                  />
                </div>
              </div>
              {errors.superTiebreak && (
                <p className="text-sm text-red-400">{errors.superTiebreak}</p>
              )}
            </div>
          )}

          {/* Match Details */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Match Details</Label>
            <div className="space-y-2">
              <div>
                <Label htmlFor="date" className="text-sm">Date & Time</Label>
                <Input
                  id="date"
                  type="datetime-local"
                  value={matchDate}
                  onChange={(e) => setMatchDate(e.target.value)}
                  className="mt-1"
                />
                {errors.date && (
                  <p className="text-sm text-red-400 mt-1">{errors.date}</p>
                )}
              </div>
              <div>
                <Label htmlFor="location" className="text-sm">Location</Label>
                <Input
                  id="location"
                  placeholder="e.g., Court 1, Sports Complex"
                  value={matchLocation}
                  onChange={(e) => setMatchLocation(e.target.value)}
                  className="mt-1"
                />
                {errors.location && (
                  <p className="text-sm text-red-400 mt-1">{errors.location}</p>
                )}
              </div>
            </div>
          </div>

          {/* Winner Preview */}
          {set1Challenger !== '' && set1Challenged !== '' && set2Challenger !== '' && set2Challenged !== '' && (
            <Card className="bg-slate-800/50 border-emerald-500/30">
              <CardContent className="pt-6">
                <p className="text-sm text-slate-400 mb-2">Match Winner</p>
                <p className="text-lg font-bold text-emerald-400">
                  {isChallengerWinning ? challengerName : challengedName}
                </p>
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
            {isLoading ? 'Submitting...' : 'Submit Result'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
