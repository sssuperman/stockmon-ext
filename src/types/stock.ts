interface UserStockResponse {
    stock_symbol: string;
    stock_name: string;
    quantity: number | null;
    average_cost: number | null;
    created_at: string;
    updated_at: string;
    is_cost_set: boolean;
    is_quantity_set: boolean;
}