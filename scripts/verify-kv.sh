#!/bin/bash

# Скрипт за верификация на KV данни в Cloudflare
# Използване: ./scripts/verify-kv.sh

set -e

echo "==================================================================="
echo "   Верификация на KV конфигурация"
echo "==================================================================="
echo ""

# Проверка дали wrangler е инсталиран
if ! command -v wrangler &> /dev/null; then
    echo "❌ Грешка: wrangler не е намерен."
    echo "   Моля, инсталирайте го с: npm install -g wrangler"
    exit 1
fi

# Зареждане на namespace ID
NAMESPACE_ID=${CF_KV_NAMESPACE_ID:-""}

if [ -z "$NAMESPACE_ID" ]; then
    echo "⚠  CF_KV_NAMESPACE_ID не е зададен."
    echo "   Моля, задайте го като environment variable"
    exit 1
fi

echo "📦 Проверка на KV namespace: $NAMESPACE_ID"
echo ""

# Масив с ключовете за проверка
declare -a KV_KEYS=(
    "iris_config_kv"
    "iris_diagnostic_map"
    "holistic_interpretation_knowledge"
    "remedy_and_recommendation_base"
)

echo "🔍 Проверка на ключове..."
echo ""

all_ok=true

for key in "${KV_KEYS[@]}"; do
    echo -n "   Проверка на $key... "
    
    if wrangler kv:key get --namespace-id="$NAMESPACE_ID" "$key" > /dev/null 2>&1; then
        echo "✓ Намерен"
    else
        echo "❌ Липсва"
        all_ok=false
    fi
done

echo ""

if [ "$all_ok" = true ]; then
    echo "==================================================================="
    echo "   ✅ Всички KV ключове са налични!"
    echo "==================================================================="
    echo ""
    
    # Проверка на max_context_entries
    echo "🔍 Проверка на критични настройки..."
    echo ""
    
    # Проверяваме дали можем да четем config_value
    if ! config_value=$(wrangler kv:key get --namespace-id="$NAMESPACE_ID" "iris_config_kv" 2>&1); then
        echo "   ⚠  Не можем да четем iris_config_kv"
        echo "      Грешка: $config_value"
        echo "      Моля, проверете достъпа до KV"
        exit 1
    fi
    
    # Проверяваме дали е валиден JSON
    if ! echo "$config_value" | grep -q '^{'; then
        echo "   ⚠  iris_config_kv не съдържа валиден JSON"
        echo "      Получена стойност: $(echo "$config_value" | head -c 100)..."
        exit 1
    fi
    
    if echo "$config_value" | grep -q '"max_context_entries".*10'; then
        echo "   ✓ max_context_entries е настроен на 10"
    else
        echo "   ⚠  max_context_entries може да не е настроен правилно"
        echo "      Очаквана стойност: 10"
        echo "      Моля, проверете ръчно с:"
        echo "      wrangler kv:key get --namespace-id=$NAMESPACE_ID iris_config_kv"
    fi
    
    if echo "$config_value" | grep -q '3-НИВОВ КОНСТИТУЦИОНАЛЕН'; then
        echo "   ✓ Analysis prompt съдържа 3-нивов анализ"
    else
        echo "   ⚠  Analysis prompt може да не съдържа 3-нивов анализ"
    fi
    
    if echo "$config_value" | grep -q 'ЕЛИМИНАТИВНИ КАНАЛИ'; then
        echo "   ✓ Промптовете съдържат елиминативни канали"
    else
        echo "   ⚠  Елиминативни канали може да не са в промптовете"
    fi
    
    echo ""
else
    echo "==================================================================="
    echo "   ❌ Някои KV ключове липсват!"
    echo "==================================================================="
    echo ""
    echo "Моля, качете липсващите ключове с:"
    echo "   ./scripts/deploy-kv.sh"
    echo ""
    exit 1
fi

echo "==================================================================="
echo "   Верификацията е завършена"
echo "==================================================================="
echo ""
