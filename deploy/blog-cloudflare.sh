#!/bin/bash

# JoyMini Blog - Cloudflare Deployment Script
# This script automates the deployment of the JoyMini Blog to Cloudflare
# Location: deploy/blog-cloudflare.sh (moved from apps/frontend-blog/scripts/deploy-cloudflare.sh)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="joymini-blog"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$ROOT_DIR/apps/frontend-blog"
OUT_DIR="$PROJECT_DIR/.open-next"
BUILD_DIR="$PROJECT_DIR/.next"
CF_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
CF_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
DOMAIN="${DOMAIN:-blog.tarsierlabs.app}"
ENVIRONMENT="${ENVIRONMENT:-production}"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm/yarn
    if ! command -v yarn &> /dev/null; then
        log_error "Yarn is not installed"
        exit 1
    fi
    
    # Check wrangler
    if ! command -v wrangler &> /dev/null; then
        log_warning "Wrangler CLI not found, installing..."
        npm install -g wrangler
    fi
    
    # Check environment variables
    if [[ -z "$CF_ACCOUNT_ID" ]]; then
        log_error "CLOUDFLARE_ACCOUNT_ID is not set"
        exit 1
    fi
    
    if [[ -z "$CF_API_TOKEN" ]]; then
        log_error "CLOUDFLARE_API_TOKEN is not set"
        exit 1
    fi
    
    log_success "All prerequisites satisfied"
}

# Build the application
build_application() {
    log_info "Building application..."
    
    cd "$PROJECT_DIR"
    
    # Clean previous build
    if [[ -d "$OUT_DIR" ]]; then
        log_info "Cleaning previous build..."
        rm -rf "$OUT_DIR"
    fi
    
    if [[ -d "$BUILD_DIR" ]]; then
        log_info "Cleaning .next directory..."
        rm -rf "$BUILD_DIR"
    fi
    
    # Install dependencies
    log_info "Installing dependencies..."
    yarn install --frozen-lockfile
    
    # Build application
    log_info "Running build..."
    yarn build
    
    # Verify build output
    if [[ ! -d "$OUT_DIR" ]]; then
        log_error "Build failed: out directory not found"
        exit 1
    fi
    
    log_success "Application built successfully"
}

# Deploy to Cloudflare Pages
deploy_to_pages() {
    log_info "Deploying to Cloudflare Pages..."
    
    cd "$PROJECT_DIR"
    
    # Login to Cloudflare if not already logged in
    if ! wrangler whoami &> /dev/null; then
        log_info "Logging in to Cloudflare..."
        echo "$CF_API_TOKEN" | wrangler login
    fi
    
    # Deploy to Pages
    log_info "Deploying to Cloudflare Pages..."
    
    if [[ "$ENVIRONMENT" == "production" ]]; then
        wrangler pages deploy "$OUT_DIR" \
            --project-name="$PROJECT_NAME" \
            --branch="main" \
            --commit-hash="$(git rev-parse HEAD 2>/dev/null || echo 'manual-deploy')" \
            --commit-message="$(git log -1 --pretty=%B 2>/dev/null || echo 'Manual deployment')" \
            --commit-dirty=false
    else
        wrangler pages deploy "$OUT_DIR" \
            --project-name="$PROJECT_NAME" \
            --branch="staging" \
            --env="$ENVIRONMENT"
    fi
    
    log_success "Deployed to Cloudflare Pages"
}

# Deploy Cloudflare Workers
deploy_workers() {
    log_info "Deploying Cloudflare Workers..."
    
    cd "$PROJECT_DIR"
    
    # Check if worker.ts exists
    if [[ ! -f "src/worker.ts" ]]; then
        log_warning "Worker file not found, skipping worker deployment"
        return 0
    fi
    
    # Deploy worker
    if [[ "$ENVIRONMENT" == "production" ]]; then
        wrangler deploy --env production
    else
        wrangler deploy --env staging
    fi
    
    log_success "Cloudflare Workers deployed"
}

# Configure DNS and SSL
configure_dns() {
    log_info "Configuring DNS and SSL..."
    
    if [[ -z "$CF_ZONE_ID" ]] || [[ -z "$DOMAIN" ]]; then
        log_warning "DNS configuration skipped (CF_ZONE_ID or DOMAIN not set)"
        return 0
    fi
    
    # Check if domain already exists
    if curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" | grep -q "$DOMAIN"; then
        log_info "DNS record for $DOMAIN already exists"
    else
        # Create DNS record
        log_info "Creating DNS record for $DOMAIN..."
        curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records" \
            -H "Authorization: Bearer $CF_API_TOKEN" \
            -H "Content-Type: application/json" \
            --data "{
                \"type\": \"CNAME\",
                \"name\": \"$DOMAIN\",
                \"content\": \"$PROJECT_NAME.pages.dev\",
                \"ttl\": 1,
                \"proxied\": true
            }"
    fi
    
    # Enable SSL
    log_info "Enabling SSL..."
    curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/ssl" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{"value":"flexible"}'
    
    log_success "DNS and SSL configured"
}

# Configure caching rules
configure_caching() {
    log_info "Configuring caching rules..."
    
    if [[ -z "$CF_ZONE_ID" ]]; then
        log_warning "Caching configuration skipped (CF_ZONE_ID not set)"
        return 0
    fi
    
    # Create page rule for caching
    log_info "Creating page rules..."
    
    # Rule 1: Cache static assets
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/pagerules" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{
            \"targets\": [
                {
                    \"target\": \"url\",
                    \"constraint\": {
                        \"operator\": \"matches\",
                        \"value\": \"$DOMAIN/*.$(css|js|woff|woff2|ttf|eot|jpg|jpeg|png|gif|webp|svg|ico)\"
                    }
                }
            ],
            \"actions\": [
                {
                    \"id\": \"cache_level\",
                    \"value\": \"cache_everything\"
                },
                {
                    \"id\": \"browser_cache_ttl\",
                    \"value\": 31536000
                },
                {
                    \"id\": \"edge_cache_ttl\",
                    \"value\": 31536000
                }
            ],
            \"priority\": 1,
            \"status\": \"active\"
        }"
    
    # Rule 2: Cache HTML pages with ISR
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/pagerules" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{
            \"targets\": [
                {
                    \"target\": \"url\",
                    \"constraint\": {
                        \"operator\": \"matches\",
                        \"value\": \"$DOMAIN/*\"
                    }
                }
            ],
            \"actions\": [
                {
                    \"id\": \"cache_level\",
                    \"value\": \"cache_everything\"
                },
                {
                    \"id\": \"edge_cache_ttl\",
                    \"value\": 300
                },
                {
                    \"id\": \"browser_cache_ttl\",
                    \"value\": 0
                }
            ],
            \"priority\": 2,
            \"status\": \"active\"
        }"
    
    log_success "Caching rules configured"
}

# Configure security settings
configure_security() {
    log_info "Configuring security settings..."
    
    if [[ -z "$CF_ZONE_ID" ]]; then
        log_warning "Security configuration skipped (CF_ZONE_ID not set)"
        return 0
    fi
    
    # Enable WAF
    log_info "Enabling WAF..."
    curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/waf" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{"value":"on"}'
    
    # Enable Bot Fight Mode
    log_info "Enabling Bot Fight Mode..."
    curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/bot_fight_mode" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{"value":"on"}'
    
    # Enable Rate Limiting
    log_info "Enabling Rate Limiting..."
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/rulesets" \
        -H "Authorization: Bearer $CF_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data '{
            "name": "Rate Limiting Ruleset",
            "description": "Rate limiting for JoyMini Blog",
            "kind": "zone",
            "phase": "http_ratelimit",
            "rules": [
                {
                    "action": "block",
                    "action_parameters": {},
                    "description": "Block excessive requests",
                    "expression": "(http.request.uri.path matches \"^/api/\") and (cf.threat_score > 5)",
                    "enabled": true
                }
            ]
        }'
    
    log_success "Security settings configured"
}

# Run health checks
run_health_checks() {
    log_info "Running health checks..."
    
    local max_retries=30
    local retry_interval=5
    local retry_count=0
    
    while [[ $retry_count -lt $max_retries ]]; do
        if curl -s -f "https://$DOMAIN/api/health" > /dev/null; then
            log_success "Health check passed"
            return 0
        fi
        
        log_info "Health check failed, retrying in ${retry_interval}s... ($((retry_count + 1))/$max_retries)"
        sleep $retry_interval
        ((retry_count++))
    done
    
    log_error "Health check failed after $max_retries attempts"
    return 1
}

# Performance audit
run_performance_audit() {
    log_info "Running performance audit..."
    
    if ! command -v lighthouse &> /dev/null; then
        log_warning "Lighthouse not installed, skipping performance audit"
        return 0
    fi
    
    lighthouse "https://$DOMAIN" \
        --output=json \
        --output-path=./lighthouse-report.json \
        --chrome-flags="--headless" \
        --only-categories=performance,accessibility,best-practices,seo
    
    local score=$(node -e "
        const report = require('./lighthouse-report.json');
        const categories = report.categories;
        Object.keys(categories).forEach(category => {
            console.log(\`\${category}: \${Math.round(categories[category].score * 100)}\`);
        });
    ")
    
    log_info "Lighthouse scores:"
    echo "$score"
    
    rm -f ./lighthouse-report.json
    
    log_success "Performance audit completed"
}

    # Main deployment function
main() {
    log_info "Starting JoyMini Blog deployment to Cloudflare"
    log_info "Environment: $ENVIRONMENT"
    log_info "Domain: $DOMAIN"
    
    # Check prerequisites
    check_prerequisites
    
    # Build application
    build_application
    
    # Deploy to Cloudflare
    deploy_to_pages
    deploy_workers
    
    # Configure Cloudflare
    configure_dns
    configure_caching
    configure_security
    
    # Wait for deployment to propagate
    log_info "Waiting for deployment to propagate..."
    sleep 30
    
    # Run health checks
    if run_health_checks; then
        # Run performance audit
        run_performance_audit
        
        log_success "Deployment completed successfully!"
        log_info "Your application is now live at: https://$DOMAIN"
        log_info "Cloudflare Dashboard: https://dash.cloudflare.com/$CF_ACCOUNT_ID/pages/view/$PROJECT_NAME"
    else
        log_error "Deployment completed but health checks failed"
        exit 1
    fi
}

# Handle command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --account-id)
            CLOUDFLARE_ACCOUNT_ID="$2"
            shift 2
            ;;
        --api-token)
            CLOUDFLARE_API_TOKEN="$2"
            shift 2
            ;;
        --zone-id)
            CLOUDFLARE_ZONE_ID="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --env <environment>     Deployment environment (production/staging)"
            echo "  --domain <domain>       Custom domain"
            echo "  --account-id <id>       Cloudflare account ID"
            echo "  --api-token <token>     Cloudflare API token"
            echo "  --zone-id <id>          Cloudflare zone ID"
            echo "  --help                  Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Run main function
main