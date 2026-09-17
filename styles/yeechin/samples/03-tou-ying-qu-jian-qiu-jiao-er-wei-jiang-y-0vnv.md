# 投影 + 区间求交（二维降一维）

> Problem: [836. 矩形重叠](https://leetcode.cn/problems/rectangle-overlap/description/)

# 思路

> 二维降一维（投影 + 区间求交）

# 解题过程

## 第一步：先把矩形压扁成两条线

题目给的 rec = [x1, y1, x2, y2]，是（左下 x，左下 y，右上 x，右上 y）。

两个矩形重叠的话很自然的能想到重叠部分也是个矩形，也就是两个矩形在x轴上重叠的区间和y轴上重叠的区间围成的范围，那么就可以直接投影把问题降为一维：

- 水平方向上 → 区间 (x1, x2)

- 竖直方向上 → 区间 (y1, y2)

于是问题变成：两个一维区间有没有交集？

## 第二步：区间求交

两个区间 (x1, x2) 和 (a1, a2)：

- 交集的左边界 = 两个左端点里更大的 → max(x1, a1)

- 交集的右边界 = 两个右端点里更小的 → min(x2, a2)

- 左边比右边还小 → 中间真有一段 → 有交集

y 轴照抄一遍就行。

## 第三步：这里是 < 不是 <=

两个矩形边贴边的时候，left == right。碰是碰到了，但重叠面积是 0，题目说不算重叠。所以必须严格小于。

（官方方法一为什么要额外判"面积为 0"？因为它是在排除四周，退化成一个点的矩形不好归类；而投影法天然把它挡掉了——max 和 min 一算就相等，< 直接判否。）

# 复杂度

- 时间复杂度: $O(1)$
- 空间复杂度: $O(1)$
- 代码复杂度：5行（官方题解1行但是对我来说这个更容易看懂）

# Code

```python3 []
class Solution:
    def isRectangleOverlap(self, rec1: List[int], rec2: List[int]) -> bool:
        left = max(rec1[0], rec2[0])     # max(x1, a1)
        right = min(rec1[2], rec2[2])    # min(x2, a2)
        below = max(rec1[1], rec2[1])    # max(y1, b1)
        above = min(rec1[3], rec2[3])    # min(y2, b2)

        return left < right and below < above
```

```typescript []
function isRectangleOverlap(rec1: number[], rec2: number[]): boolean {
    const left = Math.max(rec1[0], rec2[0]);
    const right = Math.min(rec1[2], rec2[2]);
    const below = Math.max(rec1[1], rec2[1]);
    const above = Math.min(rec1[3], rec2[3]);
    
    return left < right && below < above;
}
```

# 总结：

矩形重叠 = 两个方向上的投影都有交集，而区间有交集就是"左端点取大、右端点取小，还剩长度"。
