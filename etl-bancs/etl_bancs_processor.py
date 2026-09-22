"""
==============================================================================
SmartBancs App - Pipeline ETL de Transformacion de Datos Core Bancs (Legacy)
==============================================================================
"""

import os
import sys
import json
import re
from datetime import datetime, timezone

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import pandas as pd
import numpy as np

LEGACY_TYPE_MAPPING = {
    "01": "TRANSFER",
    "02": "SHOPPING",
    "03": "FOOD_ENTERTAINMENT",
    "99": "UNKNOWN"
}

def clean_amount(val):
    if pd.isna(val):
        return np.nan
    val_str = str(val).replace('$', '').replace(',', '').strip()
    try:
        return float(val_str)
    except ValueError:
        return np.nan

def standardize_datetime(val):
    if pd.isna(val):
        return None
    val_str = str(val).strip()
    
    formats = [
        "%Y/%m/%d %H:%M:%S",
        "%d-%m-%Y %H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y.%m.%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S"
    ]
    
    for fmt in formats:
        try:
            dt = datetime.strptime(val_str, fmt)
            return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            continue
    return None

def run_etl_pipeline(input_path="bancs_raw_transactions.csv", output_path="bancs_cleaned_features.json"):
    print("=" * 70)
    print("[ETL] Iniciando Pipeline SmartBancs - Ingestion Bancs Legacy")
    print("=" * 70)
    
    if not os.path.exists(input_path):
        print(f"[ERROR] Archivo de entrada no encontrado en {input_path}")
        return

    # 1. EXTRACT
    df_raw = pd.read_csv(input_path, dtype=str)
    total_raw_rows = len(df_raw)
    print(f"[EXTRACT] {total_raw_rows} registros extraidos desde '{input_path}'")

    # 2. TRANSFORM
    print("\n[TRANSFORM] Aplicando reglas de limpieza y estandarizacion...")

    # a. Desduplicacion por ID de transaccion
    df_dedup = df_raw.drop_duplicates(subset=["TX_ID"], keep="first").copy()
    duplicates_removed = total_raw_rows - len(df_dedup)
    print(f"   * Duplicados eliminados: {duplicates_removed}")

    # b. Limpieza de montos y manejo de nulos
    df_dedup["CLEAN_AMOUNT"] = df_dedup["RAW_AMOUNT"].apply(clean_amount)
    
    # Filtrar transacciones sin monto o con montos invalidos/NaN
    df_valid = df_dedup.dropna(subset=["CLEAN_AMOUNT"]).copy()
    null_amounts_dropped = len(df_dedup) - len(df_valid)
    print(f"   * Registros con monto nulo descartados: {null_amounts_dropped}")

    # c. Filtrar transacciones huerfanas (sin cuenta origen)
    df_valid = df_valid[df_valid["CORE_ACC_SRC"].notna() & (df_valid["CORE_ACC_SRC"].str.strip() != "") & (df_valid["CORE_ACC_SRC"].str.lower() != "nan")].copy()

    # d. Estandarizacion de fechas a UTC ISO-8601
    df_valid["ISO_TIMESTAMP"] = df_valid["TX_DATETIME"].apply(standardize_datetime)

    # e. Estandarizacion de moneda
    df_valid["CURRENCY_STD"] = df_valid["CURR"].fillna("USD").astype(str).str.upper()
    df_valid.loc[df_valid["CURRENCY_STD"] == "NAN", "CURRENCY_STD"] = "USD"
    df_valid.loc[df_valid["CURRENCY_STD"] == "", "CURRENCY_STD"] = "USD"

    # f. Mapeo de categorias de dominio
    df_valid["CATEGORY_STD"] = df_valid["TX_TYPE_CODE"].fillna("99").astype(str).str.zfill(2).map(
        lambda x: LEGACY_TYPE_MAPPING.get(x, "OTHER")
    )

    # g. Imputacion de notas de cliente nulas
    df_valid["CLIENT_NOTE"] = df_valid["CLIENT_NOTE"].fillna("Transaccion sin descripcion")
    df_valid.loc[df_valid["CLIENT_NOTE"].str.strip() == "", "CLIENT_NOTE"] = "Transaccion sin descripcion"

    # h. Feature Engineering para modelos de IA
    df_valid["IS_HIGH_VALUE"] = df_valid["CLEAN_AMOUNT"] >= 1000.0
    df_valid["LOG_AMOUNT"] = np.log1p(df_valid["CLEAN_AMOUNT"]).round(4)
    df_valid["CHANNEL_RISK_SCORE"] = df_valid["RAW_CHANNEL"].map({
        "ATM_POS": 0.15,
        "WEB_APP": 0.10,
        "MOBILE": 0.05,
        "POS": 0.20,
        "BRANCH": 0.01,
        "BATCH_CORE": 0.02
    }).fillna(0.50)

    # 3. LOAD & EXPORT
    print("\n[LOAD] Estructurando dataset optimizado para Analitica e IA...")
    
    output_records = []
    for _, row in df_valid.iterrows():
        record = {
            "transactionId": str(row["TX_ID"]),
            "sourceAccount": str(row["CORE_ACC_SRC"]).strip(),
            "targetAccount": str(row["CORE_ACC_TGT"]).strip(),
            "amount": float(row["CLEAN_AMOUNT"]),
            "currency": str(row["CURRENCY_STD"]),
            "category": str(row["CATEGORY_STD"]),
            "timestamp": str(row["ISO_TIMESTAMP"]),
            "channel": str(row["RAW_CHANNEL"]),
            "description": str(row["CLIENT_NOTE"]),
            "aiFeatures": {
                "isHighValue": bool(row["IS_HIGH_VALUE"]),
                "logAmount": float(row["LOG_AMOUNT"]),
                "channelRiskScore": float(row["CHANNEL_RISK_SCORE"])
            }
        }
        output_records.append(record)

    output_payload = {
        "metadata": {
            "pipeline": "SmartBancs-ETL-Bancs-Transformer",
            "executedAt": datetime.now(timezone.utc).isoformat(),
            "sourceFile": input_path,
            "rawRecordsCount": total_raw_rows,
            "cleanedRecordsCount": len(output_records),
            "dataQualityScore": f"{(len(output_records) / total_raw_rows) * 100:.1f}%"
        },
        "transactions": output_records
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=2, ensure_ascii=False)

    print(f"[OK] Archivo exportado exitosamente a: '{output_path}'")
    print(f"[METRICAS] Registros validos procesados: {len(output_records)} / {total_raw_rows}")
    print("=" * 70)

if __name__ == "__main__":
    run_etl_pipeline()
