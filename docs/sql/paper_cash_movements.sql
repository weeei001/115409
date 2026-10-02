CREATE TABLE IF NOT EXISTS paper_cash_movements (
    id VARCHAR(36) NOT NULL,
    user_id INTEGER NOT NULL,
    client_request_id VARCHAR(128) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_paper_cash_request UNIQUE (user_id, client_request_id),
    FOREIGN KEY (user_id) REFERENCES paper_accounts (user_id) ON DELETE CASCADE,
    INDEX ix_paper_cash_movements_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
