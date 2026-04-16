'use client'

import React, { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'

export interface AuditLogEntry {
  id: string
  timestamp: string
  actor: string
  actionType: 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'freeze' | 'unfreeze'
  entity: 'team' | 'challenge' | 'match' | 'season' | 'user'
  entityId: string
  entityName: string
  oldValue?: Record<string, any>
  newValue?: Record<string, any>
  notes?: string
}

interface AuditLogTableProps {
  entries: AuditLogEntry[]
  isLoading?: boolean
}

const actionColors: Record<string, 'default' | 'destructive' | 'played' | 'default'> = {
  create: 'played',
  update: 'default',
  delete: 'destructive',
  approve: 'played',
  reject: 'destructive',
  freeze: 'default',
  unfreeze: 'played',
}

export function AuditLogTable({ entries, isLoading }: AuditLogTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterAction, setFilterAction] = useState<string>('all')
  const [filterEntity, setFilterEntity] = useState<string>('all')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const filteredEntries = entries
    .filter((entry) => {
      const matchesSearch =
        entry.actor.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.entityName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.notes?.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesAction = filterAction === 'all' || entry.actionType === filterAction
      const matchesEntity = filterEntity === 'all' || entry.entity === filterEntity

      return matchesSearch && matchesAction && matchesEntity
    })
    .sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime()
      const timeB = new Date(b.timestamp).getTime()
      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB
    })

  const actionTypes = Array.from(new Set(entries.map((e) => e.actionType)))
  const entityTypes = Array.from(new Set(entries.map((e) => e.entity)))

  const renderDiff = (oldValue?: Record<string, any>, newValue?: Record<string, any>) => {
    if (!oldValue || !newValue) return null

    const differences: string[] = []
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)])

    allKeys.forEach((key) => {
      if (oldValue[key] !== newValue[key]) {
        differences.push(`${key}: ${oldValue[key]} → ${newValue[key]}`)
      }
    })

    return differences
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-400 block mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-400 block mb-1">
              Action
            </label>
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {actionTypes.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action.charAt(0).toUpperCase() + action.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-400 block mb-1">
              Entity
            </label>
            <Select value={filterEntity} onValueChange={setFilterEntity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Entities</SelectItem>
                {entityTypes.map((entity) => (
                  <SelectItem key={entity} value={entity}>
                    {entity.charAt(0).toUpperCase() + entity.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-400 block mb-1">
              Sort
            </label>
            <Button
              variant="outline"
              onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
              className="w-full justify-between"
            >
              <span className="text-xs">
                {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
              </span>
              {sortOrder === 'desc' ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading audit logs...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No audit log entries found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => {
                const isExpanded = expandedRow === entry.id
                const diffs = renderDiff(entry.oldValue, entry.newValue)

                return (
                  <React.Fragment key={entry.id}>
                    <TableRow
                      onClick={() =>
                        setExpandedRow(isExpanded ? null : entry.id)
                      }
                      className="cursor-pointer hover:bg-slate-800/50"
                    >
                      <TableCell>
                        <button className="rounded p-1 hover:bg-slate-700 transition-colors">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="text-sm text-slate-400 font-mono">
                        {new Date(entry.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-semibold">{entry.actor}</TableCell>
                      <TableCell>
                        <Badge variant={actionColors[entry.actionType] || 'default'}>
                          {entry.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {entry.entity}: {entry.entityName}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-slate-400">
                        {entry.notes || '—'}
                      </TableCell>
                    </TableRow>

                    {isExpanded && diffs && diffs.length > 0 && (
                      <TableRow className="bg-slate-800/30 hover:bg-slate-800/30">
                        <TableCell colSpan={6}>
                          <div className="p-4 space-y-2">
                            <p className="text-sm font-semibold text-slate-100">
                              Changes
                            </p>
                            <div className="space-y-1">
                              {diffs.map((diff, idx) => (
                                <p
                                  key={idx}
                                  className="text-xs font-mono text-slate-300"
                                >
                                  {diff}
                                </p>
                              ))}
                            </div>
                            {entry.notes && (
                              <div className="mt-3 pt-3 border-t border-slate-700">
                                <p className="text-xs font-semibold text-slate-100 mb-1">
                                  Notes
                                </p>
                                <p className="text-xs text-slate-300">{entry.notes}</p>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
