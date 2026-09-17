# 排序 + 双指针：最符合1KB小脑的解法（虽然打不过哈希表）

> Problem: [1. 双指针](https://leetcode.cn/problems/two-sum/description/)

# 思路

> 排序 + 双指针（两侧夹逼）。

> 本题最优解是哈希表 O(n)，可惜我的1KB小脑想不出来，看到这道题的时候脑子里就蹦出从两侧夹逼这个想法了，题解区这个方法似乎很少见，写出来给同样第一直觉是这个的朋友一个参考。

# 解题过程

## 第一步：打包保留下标

用 enumerate 把每个元素包装成 (值, 原下标)，排序时下标跟着值一起走，最后返回答案时再把原下标挖出来。

```
nums = [3, 2, 4]  →  [(3,0), (2,1), (4,2)]
```

## 第二步：按值排序

sort(key=lambda x: x[0])，取每一对的第 0 位（值）来比大小：

```
[(2,1), (3,0), (4,2)]
```

## 第三步：双指针夹逼

left 指向最小值，right 指向最大值：

- 和 == target → 返回两者的原下标（[1] 位）；
- 和 < target → 最小数跟谁配都不够，淘汰，left += 1；
- 和 > target → 最大数跟谁配都超了，淘汰，right -= 1。

> 数组已排序，如果"最小 + 最大"都不到 target，那最小数和区间内任何数配对都更不够，排除它不会漏解。右移同理。

# 复杂度

- 时间复杂度: $O(nlogN)$
- 空间复杂度: $O(n)$
- 代码复杂度：又臭又长

# Code

```python3
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        indexed_nums = [(num, i) for i, num in enumerate(nums)]

        indexed_nums.sort(key=lambda x: x[0])

        left = 0
        right = len(indexed_nums) - 1

        while left < right:
            left_num = indexed_nums[left][0]
            right_num = indexed_nums[right][0]
            current_sum = left_num + right_num

            if current_sum == target:
                return [indexed_nums[left][1], indexed_nums[right][1]]
            elif current_sum < target:
                left += 1
            else:
                right -= 1
                
        return []
```
