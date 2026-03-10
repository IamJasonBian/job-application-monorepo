# LinkFeed

Tracking, notifications, and application management for chained agentic workflows 

## Repository Structure

```
job-application-monorepo/
├── .github/
│   └── workflows/
│       └── sync-repos.yml          # Auto-sync from source repositories
├── packages/
│   ├── allocation-notification-service/  # Job discovery & notifications
│   ├── allocation-agent/                 # AI agent for job applications
│   └── application-manager/              # Application tracking & management
├── package.json                    # Root workspace configuration
└── README.md
```

## Packages

### 1. allocation-notification-service
**Source:** https://github.com/IamJasonBian/allocation-notification-service

Serverless job tracking system that monitors startup job postings across multiple ATS platforms (Greenhouse, Lever, Ashby) and sends Slack notifications.

**Key Features:**
- Tracks 22+ high-growth startups (OpenAI, Anthropic, Notion, Stripe, etc.)
- Multi-ATS support (Greenhouse, Lever, Ashby)
- Redis-based job diffing
- Slack webhook notifications

### 2. allocation-agent
**Source:** https://github.com/IamJasonBian/allocation-agent

AI-powered agent for automating job application processes.

### 3. application-manager
**Source:** https://github.com/IamJasonBian/application-manager

Application tracking and management system.

## Setup

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Installation

```bash
# Clone the monorepo
git clone <your-monorepo-url>
cd job-application-monorepo

# Install all dependencies
npm run install:all
```

### First-Time Sync

The GitHub Actions workflow will automatically sync packages from their source repositories. To trigger a manual sync:

```bash
# Using GitHub CLI
npm run sync

# Or manually trigger via GitHub UI
# Go to Actions → Sync Repositories → Run workflow
```

## Development

### Working with Packages

```bash
# Install dependencies for all packages
npm run install:all

# Run typecheck across all packages
npm run typecheck:all

# Clean all node_modules
npm run clean
```

### Working on Individual Packages

```bash
# Navigate to a specific package
cd packages/allocation-notification-service

# Work as normal
npm install
npm run dev
```

## Git Sync Strategy

This monorepo uses **one-way sync** from source repositories:

### How It Works

1. **Source repositories** remain the source of truth:
   - `allocation-notification-service`
   - `allocation-agent`
   - `application-manager`

2. **GitHub Actions workflow** syncs changes automatically:
   - Triggered by `repository_dispatch` webhooks from source repos
   - Falls back to 6-hour cron schedule
   - Can be manually triggered via workflow_dispatch

3. **Monorepo** is read-only for package contents:
   - Make changes in source repositories
   - Changes automatically propagate to monorepo
   - Local monorepo changes to packages will be overwritten on next sync

### Setting Up Webhooks (Optional)

To enable real-time sync on every push to source repositories:

1. Go to each source repository's Settings → Webhooks
2. Add webhook:
   - **Payload URL:** `https://api.github.com/repos/<owner>/job-application-monorepo/dispatches`
   - **Content type:** `application/json`
   - **Secret:** Your GitHub token or webhook secret
   - **Events:** Just the push event
   - **Active:** ✓

3. Add repository dispatch workflow trigger in each source repo:

```yaml
# .github/workflows/notify-monorepo.yml
name: Notify Monorepo
on:
  push:
    branches: [main]
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Repository Dispatch
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.PAT_TOKEN }}
          repository: <owner>/job-application-monorepo
          event-type: sync-request
```

## Workflow Management

The system enables end-to-end job application automation:

```
┌─────────────────────────────────┐
│ allocation-notification-service │  ─┐
│  - Job discovery                │   │
│  - Change detection (Redis)     │   │
│  - Slack notifications          │   │
└─────────────────────────────────┘   │
                                      │
┌─────────────────────────────────┐   │  End-to-End
│      allocation-agent           │   │  Application
│  - AI-powered applications      │   ├─ Management
│  - Resume customization         │   │  Pipeline
│  - Application submission       │   │
└─────────────────────────────────┘   │
                                      │
┌─────────────────────────────────┐   │
│    application-manager          │   │
│  - Track application status     │   │
│  - Interview scheduling         │   │
│  - Follow-up management         │   │
└─────────────────────────────────┘  ─┘
```

## Contributing

Since this is a synced monorepo:
- **For package changes:** Contribute to the source repositories
- **For monorepo infrastructure:** Contribute directly to this repository (workflows, root config, docs)

## License

MIT

## Contact

Jason Bian - jasonzb@umich.edu
