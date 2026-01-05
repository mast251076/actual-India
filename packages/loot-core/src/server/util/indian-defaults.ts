import * as db from '../db';

export async function seedIndianCategories() {
    // Clear existing categories if they are the defaults
    const categories = await db.getCategories();
    const groups = await db.getCategoriesGrouped();

    // If there are already a lot of categories, don't overwrite
    if (categories.length > 20) return;

    // Delete defaults
    await db.runQuery('DELETE FROM categories');
    await db.runQuery('DELETE FROM category_groups');

    const indianGroups = [
        {
            name: 'Essential Expenses',
            categories: [
                'Rent/Home Loan EMI',
                'Grocery (Kirana)',
                'Fruits & Vegetables',
                'Milk & Dairy',
                'Electricity (BESCOM/BSES)',
                'Water & Maintenance',
                'LPG/Cylinder',
                'Domestic Help (Maid/Cook)',
            ],
        },
        {
            name: 'Personal & Lifestyle',
            categories: [
                'Mobile Recharge (Jio/Airtel)',
                'Internet/Broadband',
                'Dining Out',
                'Swiggy/Zomato',
                'Entertainment/Movies',
                'OTT (Hotstar/Netflix/Prime)',
                'Clothing',
                'Personal Care/Salon',
                'Shopping (Amazon/Flipkart)',
            ],
        },
        {
            name: 'Transport',
            categories: [
                'Petrol/Diesel',
                'Auto/Uber/Ola',
                'Vehicle Maintenance',
                'Insurance (Vehicle)',
                'Public Transport (Metro/Bus)',
            ],
        },
        {
            name: 'Health & Education',
            categories: [
                'Doctor & Pharmacy',
                'Health Insurance',
                'Gym/Sports',
                'School/College Fees',
                'Books & Learning',
            ],
        },
        {
            name: 'Financial & Taxes',
            categories: [
                'Income Tax',
                'Professional Tax',
                'GST Paid',
                'Bank Fees & Charges',
                'Life Insurance (LIC/Term)',
            ],
        },
        {
            name: 'Savings & Investments',
            categories: [
                'PPF/NPS',
                'Mutual Funds (SIP)',
                'Stocks/Equity',
                'Fixed Deposit/RD',
                'Gold/Silver',
                'Emergency Fund',
            ],
        },
        {
            name: 'Gifts & Festivals',
            categories: [
                'Festivals (Diwali/Eid/Christmas)',
                'Charity/Donations',
                'Wedding/Event Gifts',
                'Pocket Money',
            ],
        },
        {
            name: 'Income',
            is_income: true,
            categories: [
                'Salary',
                'Bonus/Incentive',
                'Interest/Dividends',
                'Rental Income',
                'Starting Balances',
            ],
        },
    ];

    for (const group of indianGroups) {
        const groupId = await db.insertCategoryGroup({
            name: group.name,
            is_income: group.is_income ? 1 : 0,
        });

        for (const catName of group.categories) {
            await db.insertCategory({
                name: catName,
                cat_group: groupId,
                is_income: group.is_income ? 1 : 0,
            });
        }
    }
}
