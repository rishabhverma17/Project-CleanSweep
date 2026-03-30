#!/bin/bash
# ============================================================
# CleanSweep — Build & Deploy to Azure App Service
# ============================================================

APP_NAME="cleansweep-app"
RESOURCE_GROUP="rg-cleansweep"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH_DIR="/tmp/cleansweep-publish"
ZIP_PATH="/tmp/deploy.zip"

echo "📦 Building frontend..."
cd "$ROOT_DIR/client"
npm run build || { echo "❌ Frontend build failed"; exit 1; }

echo "📋 Copying frontend to wwwroot..."
mkdir -p "$ROOT_DIR/src/CleanSweep.API/wwwroot"
cp -r dist/* "$ROOT_DIR/src/CleanSweep.API/wwwroot/"

echo "🔨 Publishing backend..."
rm -rf "$PUBLISH_DIR" "$ZIP_PATH"
cd "$ROOT_DIR"
dotnet publish src/CleanSweep.API -c Release -o "$PUBLISH_DIR" --nologo || { echo "❌ Backend publish failed"; exit 1; }

echo "📁 Creating deployment zip..."
cd "$PUBLISH_DIR"
zip -r -q "$ZIP_PATH" .

echo "🚀 Deploying to Azure..."
az webapp deploy \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$ZIP_PATH" \
  --type zip \
  --async true || { echo "❌ Deployment failed"; exit 1; }

echo ""
echo "✅ Deployed to https://${APP_NAME}.azurewebsites.net"

# Cleanup
rm -rf "$PUBLISH_DIR" "$ZIP_PATH"
echo "🧹 Cleaned up."
