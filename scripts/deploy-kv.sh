#!/bin/bash

# Скрипт за деплойване на KV данни към Cloudflare
# Използване: ./scripts/deploy-kv.sh

set -e

echo "==================================================================="
echo "   Деплойване на KV данни към Cloudflare Workers KV"
echo "==================================================================="
echo ""

# Проверка дали wrangler е инсталиран
if ! command -v wrangler &> /dev/null; then
    echo "❌ Грешка: wrangler не е намерен."
    echo "   Моля, инсталирайте го с: npm install -g wrangler"
    exit 1
fi

echo "✓ wrangler е намерен"
echo ""

# Зареждане на namespace ID от wrangler.toml или environment
NAMESPACE_ID=${CF_KV_NAMESPACE_ID:-""}

if [ -z "$NAMESPACE_ID" ]; then
    echo "⚠  CF_KV_NAMESPACE_ID не е зададен."
    echo "   Моля, задайте го като environment variable или в wrangler.toml"
    echo ""
    echo "   Пример:"
    echo "   export CF_KV_NAMESPACE_ID=your_namespace_id"
    echo "   или задайте го в wrangler.toml"
    exit 1
fi

echo "📦 Използване на KV namespace ID: $NAMESPACE_ID"
echo ""

# Масив с файловете за качване
declare -a KV_FILES=(
    "iris_config_kv:kv/iris_config_kv.json"
    "iris_diagnostic_map:kv/iris_diagnostic_map.json"
    "holistic_interpretation_knowledge:kv/holistic_interpretation_knowledge.json"
    "remedy_and_recommendation_base:kv/remedy_and_recommendation_base.json"
)

# Качване на всеки файл
echo "📤 Качване на KV данни..."
echo ""

for item in "${KV_FILES[@]}"; do
    IFS=':' read -r key filepath <<< "$item"
    
    if [ ! -f "$filepath" ]; then
        echo "⚠  Файлът $filepath не е намерен. Пропускам..."
        continue
    fi
    
    echo "   📝 Качване на $key от $filepath..."
    
    if wrangler kv:key put --namespace-id="$NAMESPACE_ID" "$key" --path="$filepath" 2>&1; then
        echo "   ✓ $key е качен успешно"
    else
        echo "   ❌ Грешка при качване на $key"
        exit 1
    fi
    
    echo ""
done

echo "==================================================================="
echo "   ✅ Всички KV данни са качени успешно!"
echo "==================================================================="
echo ""
echo "Следващи стъпки:"
echo "1. Проверете конфигурацията с: ./scripts/verify-kv.sh"
echo "2. Деплойвайте worker-а с: wrangler publish"
echo ""
