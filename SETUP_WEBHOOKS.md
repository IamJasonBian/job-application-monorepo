# Setting Up Repository Webhooks for Auto-Sync

This guide explains how to set up automatic syncing from source repositories to the monorepo using GitHub webhooks.

## Overview

The monorepo uses GitHub Actions to sync code from three source repositories:
1. `allocation-notification-service`
2. `allocation-agent`
3. `application-manager`

By default, syncing happens:
- Every 6 hours (cron schedule)
- When manually triggered via GitHub Actions UI

To enable **real-time sync on every push**, you need to set up webhooks.

## Prerequisites

1. Personal Access Token (PAT) with `repo` scope
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Generate new token with `repo` scope
   - Save the token securely

2. Admin access to all source repositories

## Step 1: Add Webhook Workflow to Source Repositories

For each source repository (`allocation-notification-service`, `allocation-agent`, `application-manager`):

1. Create `.github/workflows/notify-monorepo.yml`:

```yaml
name: Notify Monorepo on Push

on:
  push:
    branches:
      - main  # Change if your default branch is different

jobs:
  notify-monorepo:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger monorepo sync
        uses: peter-evans/repository-dispatch@v2
        with:
          token: ${{ secrets.MONOREPO_SYNC_TOKEN }}
          repository: IamJasonBian/job-application-monorepo  # Update with your monorepo name
          event-type: sync-request
          client-payload: '{"source": "${{ github.repository }}"}'
```

2. Commit and push this workflow to each source repository

## Step 2: Add PAT Secret to Source Repositories

For each source repository:

1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `MONOREPO_SYNC_TOKEN`
4. Value: Your PAT from prerequisites
5. Click "Add secret"

## Step 3: Verify Setup

1. Make a test commit to one of the source repositories
2. Check the Actions tab - you should see "Notify Monorepo on Push" running
3. Go to the monorepo's Actions tab
4. You should see "Sync Repositories" workflow triggered
5. After completion, verify the package was updated

## Alternative: Manual Sync

If you prefer not to set up webhooks, you can manually trigger sync:

### Option 1: GitHub CLI
```bash
cd job-application-monorepo
npm run sync
```

### Option 2: GitHub UI
1. Go to monorepo Actions tab
2. Select "Sync Repositories" workflow
3. Click "Run workflow"
4. Select branch and run

## Sync Behavior

- **One-way sync**: Changes flow from source repos → monorepo
- **Overwrites local changes**: Any local edits to `packages/*` will be lost
- **Independent jobs**: Each package syncs in parallel
- **Atomic commits**: Each package gets its own commit

## Troubleshooting

### Webhook not triggering

1. Check source repository Actions tab for workflow run
2. Verify `MONOREPO_SYNC_TOKEN` secret is set
3. Ensure PAT has `repo` scope and hasn't expired
4. Check workflow syntax in `notify-monorepo.yml`

### Sync fails

1. Check monorepo Actions tab for error logs
2. Verify repository URLs in `.github/workflows/sync-repos.yml`
3. Ensure `GITHUB_TOKEN` has write permissions (should be automatic)

### Manual trigger not working

1. Install GitHub CLI: `brew install gh` (macOS) or see https://cli.github.com
2. Authenticate: `gh auth login`
3. Ensure you're in the monorepo directory
4. Verify workflow file exists at `.github/workflows/sync-repos.yml`

## Security Notes

- **PAT Security**: Store PAT only as GitHub secret, never commit to code
- **Token Scope**: Use minimal scope (only `repo` needed)
- **Token Rotation**: Rotate PAT periodically and update secrets
- **Access Control**: Only grant PAT access to necessary repositories

## Monitoring

To monitor sync activity:

```bash
# View recent sync commits
cd job-application-monorepo
git log --grep="chore: sync" --oneline -n 10

# Check package update times
ls -la packages/*/
```

## Disabling Auto-Sync

To disable webhook-based sync:

1. Remove `notify-monorepo.yml` from source repositories
2. Delete `MONOREPO_SYNC_TOKEN` secrets
3. Sync will fall back to 6-hour cron schedule

To disable all automatic sync:

1. Edit `.github/workflows/sync-repos.yml` in monorepo
2. Remove the `schedule` and `repository_dispatch` triggers
3. Keep only `workflow_dispatch` for manual sync
