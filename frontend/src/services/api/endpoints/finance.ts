/**
 * 予算・費用(FR-027)・立替・精算(FR-028)
 *
 * [Gate P2] backend/app/api/v1/finance.py。/plans/{planId}配下。
 * 楽観ロックは予算・支出・精算ごとのrevision(If-Match)。基準通貨は設定のrevision(未設定は0)。
 */
import { PreparationApi } from './preparation';
import type {
  Budget, BudgetCreateData, Expense, ExpenseCreateData, ExpenseUpdateData, FinanceSettings, FinanceSummary,
  Settlement, SettlementCreateData,
} from '../types';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class FinanceApi extends PreparationApi {
  async getFinanceSettings(planId: string): Promise<FinanceSettings> {
    const response = await this.client.get(`/plans/${planId}/finance-settings`);
    return decodeResponse(response.data, (await DL()).financeSettings, 'GET /plans/{plan_id}/finance-settings');
  }

  async updateFinanceSettings(planId: string, baseCurrency: string, ifMatch: number): Promise<FinanceSettings> {
    const response = await this.client.put(
      `/plans/${planId}/finance-settings`, { base_currency: baseCurrency }, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).financeSettings, 'PUT /plans/{plan_id}/finance-settings');
  }

  async getBudgets(planId: string): Promise<Budget[]> {
    const response = await this.client.get(`/plans/${planId}/budgets`);
    return decodeResponse(response.data, arrayOf((await DL()).budget), 'GET /plans/{plan_id}/budgets');
  }

  async createBudget(planId: string, data: BudgetCreateData): Promise<Budget> {
    const response = await this.client.post(`/plans/${planId}/budgets`, data);
    return decodeResponse(response.data, (await DL()).budget, 'POST /plans/{plan_id}/budgets');
  }

  async updateBudget(
    planId: string, budgetId: string, data: { amount?: string; note?: string | null }, ifMatch: number
  ): Promise<Budget> {
    const response = await this.client.patch(
      `/plans/${planId}/budgets/${budgetId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).budget, 'PATCH /plans/{plan_id}/budgets/{budget_id}');
  }

  async deleteBudget(planId: string, budgetId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/budgets/${budgetId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).revisionResult, 'DELETE /plans/{plan_id}/budgets/{budget_id}');
  }

  async getExpenses(planId: string): Promise<Expense[]> {
    const response = await this.client.get(`/plans/${planId}/expenses`);
    return decodeResponse(response.data, arrayOf((await DL()).expense), 'GET /plans/{plan_id}/expenses');
  }

  async createExpense(planId: string, data: ExpenseCreateData): Promise<Expense> {
    const response = await this.client.post(`/plans/${planId}/expenses`, data);
    return decodeResponse(response.data, (await DL()).expense, 'POST /plans/{plan_id}/expenses');
  }

  async updateExpense(planId: string, expenseId: string, data: ExpenseUpdateData, ifMatch: number): Promise<Expense> {
    const response = await this.client.patch(
      `/plans/${planId}/expenses/${expenseId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).expense, 'PATCH /plans/{plan_id}/expenses/{expense_id}');
  }

  async deleteExpense(planId: string, expenseId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/expenses/${expenseId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).revisionResult, 'DELETE /plans/{plan_id}/expenses/{expense_id}');
  }

  async getSettlements(planId: string): Promise<Settlement[]> {
    const response = await this.client.get(`/plans/${planId}/settlements`);
    return decodeResponse(response.data, arrayOf((await DL()).settlement), 'GET /plans/{plan_id}/settlements');
  }

  async createSettlement(planId: string, data: SettlementCreateData): Promise<Settlement> {
    const response = await this.client.post(`/plans/${planId}/settlements`, data);
    return decodeResponse(response.data, (await DL()).settlement, 'POST /plans/{plan_id}/settlements');
  }

  async deleteSettlement(planId: string, settlementId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/settlements/${settlementId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, (await DL()).revisionResult, 'DELETE /plans/{plan_id}/settlements/{settlement_id}');
  }

  async getFinanceSummary(planId: string): Promise<FinanceSummary> {
    const response = await this.client.get(`/plans/${planId}/finance-summary`);
    return decodeResponse(response.data, (await DL()).financeSummary, 'GET /plans/{plan_id}/finance-summary');
  }
}
