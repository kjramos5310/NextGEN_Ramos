-- ==============================================================================
-- SmartBancs App - DML Seed Data
-- ==============================================================================

INSERT INTO accounts (account_number, account_holder, client_id, type, balance, currency, status)
VALUES 
    ('1000000001', 'Carlos Andrés Mendoza', 'CLI-84920', 'CHECKING', 15450.00, 'USD', 'ACTIVE'),
    ('1000000002', 'Valeria Sofía Gómez', 'CLI-73819', 'SAVINGS', 8320.50, 'USD', 'ACTIVE'),
    ('1000000003', 'Empresas & Retail S.A.', 'CLI-99201', 'CHECKING', 145000.00, 'USD', 'ACTIVE'),
    ('1000000004', 'Mateo Alejandro Torres', 'CLI-55412', 'SAVINGS', 3200.00, 'USD', 'ACTIVE'),
    ('1000000005', 'Distribuidora Global Tech', 'CLI-66190', 'INVESTMENT', 290000.00, 'USD', 'ACTIVE')
ON CONFLICT (account_number) DO NOTHING;
