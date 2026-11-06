import unittest
from decimal import Decimal
from calculator import calculate, number

class CalculationTests(unittest.TestCase):
    def test_fca(self):
        self.assertAlmostEqual(calculate('FCA', '.85', 'USD', 100, 14, 22000, 2250, 0)[2], Decimal('95.2272727273'), places=8)

    def test_cpt_does_not_double_freight(self):
        self.assertEqual(calculate('CPT', '1.05', 'USD', 100, 14, 20000, 4000, 0)[2], 105)

    def test_mixed_freight(self):
        self.assertEqual(calculate('FOB', '9.2', 'CNY', 100, 14, 26800, 4250, 400000)[2], Decimal('128.8') + Decimal(825000) / 26800)

    def test_invalid(self):
        for value in ('NaN', 'Infinity', '-1', 'text'):
            with self.assertRaises(ValueError):
                number(value)
        with self.assertRaises(ValueError):
            calculate('FCA', 1, 'USD', 100, 14, 0, 1, 0)

if __name__ == '__main__':
    unittest.main()
