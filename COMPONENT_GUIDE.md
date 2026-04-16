# Chiniot Padel League - Component Guide

Quick reference for using the CPL component library.

## Base UI Components

### Button
```tsx
import { Button } from '@/components/ui/button'

<Button>Click me</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline" size="sm">Secondary</Button>
<Button variant="ghost">Minimal</Button>
<Button variant="link">Link button</Button>
```

**Variants**: default, destructive, outline, secondary, ghost, link
**Sizes**: default (h-10), sm (h-8), lg (h-12), icon (h-10 w-10)

### Input
```tsx
import { Input } from '@/components/ui/input'

<Input placeholder="Enter text..." />
<Input type="email" placeholder="Email..." />
<Input type="datetime-local" />
```

### Card
```tsx
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>Footer</CardFooter>
</Card>
```

### Badge
```tsx
import { Badge } from '@/components/ui/badge'

// Tier badges
<Badge variant="diamond">Diamond</Badge>
<Badge variant="platinum">Platinum</Badge>
<Badge variant="gold">Gold</Badge>

// Status badges
<Badge variant="pending">Pending</Badge>
<Badge variant="scheduled">Scheduled</Badge>
<Badge variant="played">Played</Badge>
<Badge variant="forfeited">Forfeited</Badge>
```

### Select
```tsx
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Select..." />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="opt1">Option 1</SelectItem>
    <SelectItem value="opt2">Option 2</SelectItem>
  </SelectContent>
</Select>
```

### Dialog
```tsx
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

<Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger>Open</DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
    </DialogHeader>
    Content
  </DialogContent>
</Dialog>
```

### Table
```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Header 1</TableHead>
      <TableHead>Header 2</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Data 1</TableCell>
      <TableCell>Data 2</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

### Tabs
```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">Tab 1</TabsTrigger>
    <TabsTrigger value="tab2">Tab 2</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
  <TabsContent value="tab2">Content 2</TabsContent>
</Tabs>
```

### Alert
```tsx
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'

<Alert variant="default">
  <AlertTitle>Title</AlertTitle>
  <AlertDescription>Description</AlertDescription>
</Alert>

<Alert variant="destructive">Error alert</Alert>
<Alert variant="warning">Warning alert</Alert>
<Alert variant="success">Success alert</Alert>
```

### Avatar
```tsx
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

<Avatar>
  <AvatarImage src="/avatar.jpg" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

### DropdownMenu
```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

<DropdownMenu>
  <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>Option 1</DropdownMenuItem>
    <DropdownMenuItem>Option 2</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

## Custom UI Components

### StatCard
```tsx
import { StatCard } from '@/components/ui/stat-card'
import { Trophy } from 'lucide-react'

<StatCard
  title="Total Wins"
  value={42}
  subtitle="This season"
  icon={<Trophy className="h-6 w-6" />}
  trend="up"
  trendValue="+5 vs last season"
  color="emerald"
/>
```

**Colors**: emerald, cyan, amber, red, slate

### TierBadge
```tsx
import { TierBadge } from '@/components/ui/tier-badge'

<TierBadge tier="Diamond" size="sm" />
<TierBadge tier="Gold" size="md" />
<TierBadge tier="Bronze" size="lg" />
```

**Sizes**: sm, md, lg

### CountdownTimer
```tsx
import { CountdownTimer } from '@/components/ui/countdown-timer'

<CountdownTimer
  deadline="2026-04-10T23:59:00Z"
  onExpire={() => console.log('Expired!')}
  showSeconds={true}
/>
```

---

## Layout Components

### Navbar
```tsx
import { Navbar } from '@/components/layout/Navbar'

<Navbar
  isAdmin={true}
  userAvatar="/avatar.jpg"
  userName="John Doe"
  unreadCount={3}
  onNotificationClick={handleNotifications}
  onLogout={handleLogout}
/>
```

### Sidebar (Admin)
```tsx
import { Sidebar } from '@/components/layout/Sidebar'

<Sidebar isAdmin={true} />
```

---

## Feature Components

### LadderTable
```tsx
import { LadderTable } from '@/components/ladder/LadderTable'

<LadderTable
  entries={[
    {
      id: '1',
      rank: 1,
      teamName: 'Team A',
      players: ['John', 'Jane'],
      tier: 'Diamond',
      status: 'available',
      wins: 10,
      losses: 2,
      isMyTeam: true,
    },
    // ... more entries
  ]}
  onRowClick={(entry) => navigate(`/team/${entry.id}`)}
/>
```

### ChallengeCard
```tsx
import { ChallengeCard } from '@/components/challenges/ChallengeCard'

<ChallengeCard
  code="01-0042"
  challenger={{ name: "Team A", rank: 5 }}
  challenged={{ name: "Team B", rank: 8 }}
  status="pending"
  timeSlots={[
    '2026-04-10T19:00:00Z',
    '2026-04-11T19:00:00Z',
    '2026-04-12T19:00:00Z',
  ]}
  deadline="2026-04-08T23:59:00Z"
  userRole="challenged"
  match={{
    date: '2026-04-10T19:00:00Z',
    location: 'Court 1',
  }}
  onAccept={handleAccept}
  onReject={handleReject}
  onReport={handleReport}
  onClick={() => navigate(`/challenge/01-0042`)}
/>
```

**Status**: pending, scheduled, played, forfeited, dissolved
**User Roles**: challenger, challenged, spectator

### SendChallengeModal
```tsx
import { SendChallengeModal } from '@/components/challenges/SendChallengeModal'

<SendChallengeModal
  open={modalOpen}
  onOpenChange={setModalOpen}
  eligibleTeams={[
    { id: '1', name: 'Team A', rank: 5 },
    { id: '2', name: 'Team B', rank: 8 },
  ]}
  onSubmit={async (data) => {
    // Send challenge API call
    await sendChallenge(data)
  }}
  isLoading={loading}
/>
```

### MatchResultForm
```tsx
import { MatchResultForm } from '@/components/matches/MatchResultForm'

<MatchResultForm
  open={formOpen}
  onOpenChange={setFormOpen}
  challengerName="Team A"
  challengedName="Team B"
  onSubmit={async (data) => {
    // Report match result
    await reportMatch(data)
  }}
  isLoading={loading}
/>
```

### AuditLogTable
```tsx
import { AuditLogTable } from '@/components/admin/AuditLogTable'

<AuditLogTable
  entries={[
    {
      id: '1',
      timestamp: '2026-04-07T10:30:00Z',
      actor: 'admin@example.com',
      actionType: 'update',
      entity: 'team',
      entityId: 'team-1',
      entityName: 'Team A',
      oldValue: { status: 'active' },
      newValue: { status: 'frozen' },
      notes: 'Frozen due to inactivity',
    },
    // ... more entries
  ]}
  isLoading={false}
/>
```

---

## Styling & Utilities

### ClassName Utilities
```tsx
import { cn } from '@/lib/utils'

<div className={cn('base-class', condition && 'conditional-class')}>
  Content
</div>
```

### Constants
```tsx
import { TIER_CONFIG, CHALLENGE_STATUS_CONFIG, VALIDATION } from '@/lib/constants'

const tierInfo = TIER_CONFIG.diamond
const statusInfo = CHALLENGE_STATUS_CONFIG.pending
const maxPositions = VALIDATION.CHALLENGE_POSITIONS_ABOVE
```

### Dark Theme CSS Variables
```css
/* Available CSS variables */
--background: #0f172a (slate-950)
--card: #1e293b (slate-800)
--border: #334155 (slate-700)
--primary: #10B981 (emerald-500)
--foreground: #f1f5f9 (slate-100)
--muted-foreground: #94a3b8 (slate-400)
```

### Utility Classes
```tsx
<div className="glass-card">Glass morphism effect</div>
<h1 className="gradient-text">Gradient text</h1>
<div className="tier-diamond">Diamond tier styling</div>
```

---

## Common Patterns

### Form with Validation
```tsx
const [errors, setErrors] = useState<Record<string, string>>({})

const validate = () => {
  const newErrors: Record<string, string> = {}
  if (!selectedTeam) newErrors.team = 'Required'
  setErrors(newErrors)
  return Object.keys(newErrors).length === 0
}

<Input
  value={value}
  onChange={(e) => setValue(e.target.value)}
/>
{errors.field && <p className="text-sm text-red-400">{errors.field}</p>}
```

### Loading State
```tsx
{isLoading ? (
  <div className="text-center text-slate-400">Loading...</div>
) : (
  <div>Content</div>
)}
```

### Mobile Responsive
```tsx
<div className="hidden md:flex">Desktop only</div>
<div className="md:hidden">Mobile only</div>
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">Responsive grid</div>
```

---

## Design System

### Colors
```
Primary: #10B981 (Emerald)
Diamond: #06B6D4 (Cyan)
Platinum: #64748B (Slate)
Gold: #F59E0B (Amber)
Silver: #9CA3AF (Gray)
Bronze: #F97316 (Orange)
Destructive: #DC2626 (Red)
```

### Spacing (Tailwind Scale)
```
xs: 0.25rem (1px)
sm: 0.5rem (2px)
md: 1rem (4px)
lg: 1.5rem (6px)
xl: 2rem (8px)
```

### Border Radius
```
sm: 0.5rem (4px)
md: 0.75rem (6px)
lg: 1rem (8px)
xl: 1.25rem (10px)
2xl: 1.5rem (12px)
```

---

## Best Practices

1. **Always use `cn()` for conditional classes**: Merges and deduplicates Tailwind classes
2. **Component composition**: Build complex UIs from smaller components
3. **Props over global state**: Pass data via props when possible
4. **Dark theme first**: All components assume dark mode
5. **Type safety**: Always type component props with TypeScript
6. **Accessibility**: Use semantic HTML and ARIA labels
7. **Mobile first**: Design for mobile, then enhance for desktop
8. **Loading states**: Always show loading indicators for async operations
9. **Error handling**: Validate forms and show user-friendly errors
10. **Responsive design**: Use responsive utilities (sm:, md:, lg:)

---

## Common Issues & Solutions

### Dropdown not showing
- Ensure parent has `z-index` and proper positioning
- Check if modal/dialog is blocking (higher z-index needed)

### Dialog overlay too dark
- Adjust opacity in dialog overlay: `bg-slate-950/80`

### Countdown timer stuck
- Ensure `deadline` is valid ISO date string
- Component is client-side only, add `'use client'`

### Form inputs not saving
- Verify onChange handlers are properly bound
- Check for conflicting CSS that hides/disables inputs

### Mobile menu not closing
- Ensure onClick handlers call `setMobileMenuOpen(false)`
- Mobile overlay should also close menu on click
