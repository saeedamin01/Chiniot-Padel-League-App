# 🎾 Chiniot Padel League — App

A modern, production-ready Next.js 14 application for managing the Chiniot Padel League — a competitive padel ladder league with tiered rankings, challenges, match tracking, and prize management.

## Overview

The Chiniot Padel League app is a full-featured platform for organizing and managing padel league competitions. It features:

- **Dynamic Ladder System**: Real-time ranking across 5 competitive tiers (Diamond, Platinum, Gold, Silver, Bronze)
- **Challenge-Based Matches**: Players challenge teams within their tier or one tier above/below
- **Match Management**: Complete match tracking with score recording, result verification, and dispute resolution
- **Admin Dashboard**: Comprehensive tools for managing teams, seasons, and league operations
- **Automated Systems**: Auto-forfeit on timeout, rank freeze/drops, and result verification queues
- **Responsive Design**: Beautiful, dark-themed UI optimized for desktop and mobile
- **Authentication**: Secure user accounts with role-based access control (Admin, Team Captain, Player)

## Tech Stack

- **Frontend**: Next.js 14 (React, TypeScript)
- **Styling**: Tailwind CSS + custom animations
- **Backend**: Next.js API Routes + Server Actions
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Email**: SMTP (Gmail or custom provider)
- **Deployment**: Docker + Docker Compose + Traefik
- **Icons**: Lucide React

## Local Development

### Prerequisites

- Node.js 20+ (Alpine-compatible)
- npm or yarn
- Git

### Setup

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd cpl-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env.local
   ```

4. **Configure environment variables** (see section below)

5. **Run development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

6. **Build for production**
   ```bash
   npm run build
   npm start
   ```

## Environment Variables

Create a `.env.local` file with the following variables:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# SMTP Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@chiniotpadelleague.com

# App URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron Jobs Security
CRON_SECRET=your-super-secret-cron-token
```

### Supabase Setup

1. **Create a Supabase account** at [supabase.com](https://supabase.com)

2. **Create a new project** with:
   - Region: Closest to your users (e.g., Singapore for Pakistan)
   - Database: PostgreSQL

3. **Run migrations**
   ```bash
   # Copy your service role key and run from supabase/migrations folder
   supabase db push
   ```

4. **Configure authentication**
   - Go to Authentication → Providers
   - Enable Email/Password provider
   - Set redirect URLs: `http://localhost:3000/auth/callback` and `https://your-domain.com/auth/callback`

5. **Get API keys**
   - Go to Settings → API
   - Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Copy `SERVICE_ROLE_KEY`

### Gmail SMTP Setup

1. **Enable 2-factor authentication** on your Gmail account

2. **Generate an App Password**
   - Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   - Select Mail and Windows Computer
   - Copy the generated 16-character password
   - Use this as `SMTP_PASS` in your `.env.local`

3. **Alternative SMTP providers**
   - SendGrid, Mailgun, AWS SES, or your own mail server

## Supabase Database

The app uses Supabase for authentication and database storage. Key tables include:

- **profiles**: User profiles with roles and preferences
- **teams**: Team information with captains and members
- **challenges**: Challenge requests between teams
- **matches**: Match records with scores and status
- **seasons**: Season configuration and status
- **tiers**: Tier definitions and constraints
- **ladder**: Real-time ranking and points tracking

Run migrations automatically:
```bash
npm run db:migrate
```

## Directory Structure

```
cpl-app/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Landing page
│   ├── layout.tsx         # Root layout
│   ├── (auth)/            # Authentication routes
│   ├── (dashboard)/       # Protected dashboard routes
│   └── api/               # API routes and endpoints
├── components/            # Reusable React components
├── lib/                   # Utility functions and helpers
├── types/                 # TypeScript type definitions
├── supabase/             # Database migrations and functions
├── public/               # Static assets
├── Dockerfile            # Docker build configuration
├── docker-compose.yml    # Docker Compose setup
└── tailwind.config.ts    # Tailwind CSS configuration
```

## Features

### 1. Public Landing Page
- Beautiful hero section showcasing the league
- Season statistics and overview
- Tier explanations and prize pools
- Call-to-action buttons for registration/sign-in
- Responsive mobile design

### 2. Authentication
- Email/password signup and login
- Password reset and email verification
- Role-based access control (Admin, Captain, Player)

### 3. Team Management
- Create and manage teams
- Add/remove team members
- Team roster and statistics
- Team captain controls

### 4. Ladder & Rankings
- Real-time ladder display with 5 tiers
- Points-based ranking system
- Team statistics (wins, losses, points)
- Head-to-head records
- Tier movement tracking

### 5. Challenge System
- Challenge teams in same tier or adjacent tier
- Automatic challenge expiry
- Challenge acceptance/decline with reasons
- Challenge history and statistics

### 6. Match Management
- Create match records for accepted challenges
- Score recording (detailed match stats)
- Result verification queue for admin review
- Dispute handling and resolution
- Auto-forfeit on timeout (72 hours from creation)

### 7. Admin Dashboard
- Season management (create, pause, end)
- Team management and approvals
- Manual rank adjustments
- Match result verification
- Player management and role assignment
- League statistics and reports
- Automated job scheduling

### 8. Automated Systems
- **Auto-forfeit**: Matches with no result after 72 hours → auto-forfeit
- **Rank Freeze/Drops**: Automatic tier movement when point thresholds crossed
- **Result Verification**: Admin queue for reviewing submitted results
- **Email Notifications**: Match updates, challenge notifications, result confirmations
- **Cron Jobs**: Scheduled tasks for automated maintenance

### 9. Analytics & Reports
- League statistics dashboard
- Team performance metrics
- Player statistics and head-to-head records
- Seasonal performance tracking
- Prize pool allocation

## Deployment

### Local Docker Development

1. **Build and run with Docker Compose**
   ```bash
   docker-compose up --build
   ```

2. **Access the app**
   - http://localhost:3000

3. **View logs**
   ```bash
   docker-compose logs -f cpl-app
   ```

4. **Stop services**
   ```bash
   docker-compose down
   ```

### Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete Hetzner VPS deployment guide.

## First-Run Checklist

After deploying, complete these setup steps:

- [ ] Create admin account via registration
- [ ] Verify admin user in Supabase dashboard
- [ ] Create Season 3 (start date, end date, tier settings)
- [ ] Add teams and team captains
- [ ] Configure SMTP email settings
- [ ] Test email notifications
- [ ] Add initial ladder entries
- [ ] Configure tier rules and constraints
- [ ] Setup cron jobs on server
- [ ] Test auto-forfeit and freeze-drop systems
- [ ] Verify DNS and SSL certificate
- [ ] Monitor application logs

## Admin Guide

### Creating a Season

1. Go to Admin Dashboard → Seasons
2. Click "Create New Season"
3. Set season dates and configuration
4. Define tier constraints (min/max teams per tier)
5. Set prize amounts for each tier
6. Publish season

### Managing Teams

1. Go to Admin Dashboard → Teams
2. Review pending team applications
3. Approve/reject teams
4. Assign team captains
5. Manage team members

### Handling Disputes

1. Go to Admin Dashboard → Disputes/Results
2. Review flagged matches
3. View submitted evidence/photos
4. Make final ruling (accept/reject/custom adjustment)
5. Update ladder accordingly

### Running Cron Jobs

The following jobs run automatically on the server (configured in Traefik):

```bash
# Every 15 minutes: Process challenge forfeits (72-hour timeout)
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/challenge-forfeit

# Every 15 minutes: Process rank freezes/drops
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/freeze-drops

# Every 30 minutes: Verify match results
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/result-verify
```

## API Endpoints

### Public
- `GET /` - Landing page
- `GET /ladder` - Public ladder view
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/reset-password` - Password reset

### Protected (Authenticated)
- `GET /api/user/profile` - Current user profile
- `PUT /api/user/profile` - Update profile
- `GET /api/teams` - User's teams
- `POST /api/challenges` - Create challenge
- `GET /api/challenges` - User's challenges
- `PUT /api/challenges/:id` - Respond to challenge
- `POST /api/matches` - Create match
- `PUT /api/matches/:id` - Submit match result
- `GET /api/matches` - User's matches

### Admin Only
- `GET /api/admin/teams` - All teams (with approval status)
- `PUT /api/admin/teams/:id` - Approve/manage team
- `POST /api/admin/seasons` - Create season
- `PUT /api/admin/seasons/:id` - Update season
- `GET /api/admin/disputes` - Pending disputes
- `PUT /api/admin/disputes/:id` - Resolve dispute
- `POST /api/admin/ranks` - Manual rank adjustment
- `GET /api/admin/stats` - League statistics

### Cron (Secret Authorization)
- `POST /api/cron/challenge-forfeit` - Auto-forfeit challenges
- `POST /api/cron/freeze-drops` - Process tier movements
- `POST /api/cron/result-verify` - Verify pending results

## FAQ

**Q: How many teams can be in a tier?**
A: By default: Diamond (1-4), Platinum (5-19), Gold (20-34), Silver (35-49), Bronze (50+). Customizable per season.

**Q: What happens if a match result is disputed?**
A: Admins review the submission and supporting evidence. They can approve, reject, or propose a custom adjustment.

**Q: How long do teams have to submit match results?**
A: 72 hours from match creation. After this, the match auto-forfeits to the challenging team.

**Q: Can a team challenge multiple times?**
A: Yes, but only one active challenge per team pair at a time.

**Q: What's the prize structure?**
A: Season-dependent, configured in admin settings. Default: Diamond tier winners get PKR 60K first place, PKR 30K second place, etc.

**Q: How are points calculated?**
A: Points are based on: match win (10 pts), opponent tier level, head-to-head record. Formula is configurable.

**Q: Can I integrate with WhatsApp/Telegram notifications?**
A: Yes, extend `lib/email.ts` with webhook integrations for messaging apps.

## Troubleshooting

### App won't start
- Check `.env.local` has all required variables
- Verify Supabase project is active and accessible
- Check Node.js version is 20+

### Supabase connection errors
- Verify `NEXT_PUBLIC_SUPABASE_URL` and keys are correct
- Check Supabase project isn't paused
- Test API access from Postman

### Email not sending
- Verify SMTP credentials are correct
- Check Gmail app password (not regular password)
- Look for "Less secure app access" warnings in Gmail
- Test SMTP connection: `telnet smtp.gmail.com 587`

### Docker build fails
- Clear Docker cache: `docker system prune -a`
- Rebuild: `docker-compose up --build`
- Check Dockerfile paths are correct for your setup

### Cron jobs not running
- Verify `CRON_SECRET` is set in environment
- Check domain DNS is resolved correctly
- Monitor logs: `docker-compose logs -f`
- Test manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron/freeze-drops`

## Contributing

1. Create a feature branch
2. Make changes
3. Test locally
4. Submit pull request

## License

© 2026 Chiniot Padel League. All rights reserved.

## Support

For issues, feature requests, or questions:
- Email: support@chiniotpadelleague.com
- Discord: [Join Community Server]
- GitHub Issues: [Report issues here]
