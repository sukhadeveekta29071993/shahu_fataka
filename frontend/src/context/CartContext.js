import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

const CartContext = createContext(null);
const KEY = "crackerpos_cart_v1";

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const add = useCallback((product, qty = 1) =>
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === product.id);
      if (found) {
        return prev.map((i) => (i.product_id === product.id ? { ...i, qty: Math.min(i.qty + qty, 99) } : i));
      }
      return [...prev, { product_id: product.id, qty }];
    }), []);

  const setQty = useCallback((productId, qty) =>
    setItems((prev) =>
      qty <= 0
        ? prev.filter((i) => i.product_id !== productId)
        : prev.map((i) => (i.product_id === productId ? { ...i, qty } : i))
    ), []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({ items, add, setQty, clear }), [items, add, setQty, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
