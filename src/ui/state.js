export const state = {
    currentFundsData: [],
    sortField: 'todayProfit',
    sortDirection: -1,
    selectedCodes: new Set(),
    lastClickedIndex: -1,

    clearSelection() {
        this.selectedCodes.clear();
        this.lastClickedIndex = -1;
    }
};
