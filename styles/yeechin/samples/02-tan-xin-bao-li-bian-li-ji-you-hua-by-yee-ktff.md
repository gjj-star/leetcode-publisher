# 贪心（暴力遍历及优化）

> Problem: [2472. 不重叠回文子字符串的最大数目](https://leetcode.cn/problems/maximum-number-of-non-overlapping-palindrome-substrings/description/)

# 思路

> 贪心

# 解题过程

## **第一步：先被两个坑各踹一脚**

### **坑 1：长度是"至少 k"，不是"正好 k"**

我最开始只检查长度为 k 的窗口，`s = "abaccdbbd", k = 3` 只找到` "aba"`，返回 1。但答案是 2，因为还有个 `"dbbd"`（长度 4）。所以候选长度得放开。

### 坑 2：我算成了"所有回文串的数量"

放开长度之后，`s = "aaaaaaaaaaa", k = 3 `我的程序返回 45，答案是 3。

原因很直白：全`a` 的串里，长度 3 的有 9 个、长度 4 的有 8 个……加起来 9+8+…+1 = 45。但我算的是"一共有多少个合法回文"，题目要的是"最多能选几个互不重叠的"。正确答案是 `aaa | aaa | aaa`，3 个。

**到这里才算真正读懂题：这题不是统计回文，是从一堆合法区间里挑最多个互不重叠的区间。**

## 第二步：贪心到底按什么排

一开始我以为"选最短的"就行，后来发现这个说法不准确。看` s = "aabbaaaaa", k = 4：`

- 有个 `"aabbaa"`，长度 6，起点最早。选它 → `aabbaa | aaa`，只能拿 1 个；

- 但里面有 `"abba"` 和` "aaaa"`，选这两个能拿 2 个。

所以规则不是"**最短优先**"，也不是"**起点最早优先**"，而是：

> **结束位置最早优先。**

理由也直观：**结束得越早，留给后面的空间越大，越有机会放下更多回文**。

## 第三步：把"不重叠"翻译成"截断范围"

选中一个回文后，假设它结束在下标`end`，那后面的候选起点必须满足`left >= end`——不然就和已选的区间重叠了。

所以代码里就是一句`if left < end: continue`（`if left < end`:后面的`continue`千万别顺手写成 `break`。因为`break`会让外层`for`的`else`不执行，于是`right += 1`也不执行，`while`下一轮还是同一个`right`，可能直接卡住。这种坑不报错，只是死循环，特别费时间）。

## 第四步：只检查 k 和 k+1 就够了

这一步是我觉得最妙的地方。假设有个长度大于`k+1` 的回文：

```
a b c c b a
```

**把最外面一对删掉：**

```
b c c b
```

**依然是回文**

因为原来对称的位置，删掉首尾这对之后对称关系没变。

也就是说，长回文可以不断"去头去尾"，每次长度减 2，最后一定缩到 k 或 k+1（减法一直是 -2，奇偶性不变，所以这两个长度刚好覆盖两种奇偶情况）。

而缩出来的这个短回文，结束位置比原来的长回文更早。既然我们要的就是"最早结束"，那更长的那些根本不用看。于是每个`right`最多只检查两种长度，性能直接从 O(n³) 降到 O(nk)。

# 复杂度

- 时间复杂度: $O(n^3)$→$O(nk)$
- 空间复杂度: $O(n)$→$O(k)$

# Code

```python3 [暴力]
class Solution:
    def maxPalindromes(self, s: str, k: int) -> int:
        n = len(s)
        count = 0
        end = 0
        right = k

        while right <= n:
            for left in range(end, right - k + 1):
            
                t = s[left:right]

                for i in range(len(t) // 2):
                    if t[i] != t[len(t) - 1 - i]:
                        break
                else:
                    count += 1
                    end = right
                    right = end + k
                    break
            else:
                right += 1

        return coun
```

```python3 [优化]
class Solution:
    def maxPalindromes(self, s: str, k: int) -> int:
        n = len(s)
        count = 0
        end = 0
        right = k

        while right <= n:
            for length in (k, k+1):
                left = right - length

                if left < end:
                    continue
                
                t = s[left:right]

                for i in range(len(t)//2):
                    if t[i] != t[len(t) - i - 1] :
                        break
                else:
                    count += 1
                    end = right
                    right = end + k
                    break
            else:
                right +=1
                
        return count
```

# 总结

解题核心在于“贪心”：选择最早结束的回文；解题的前提是“子串互不重叠”：选中一个回文以后，需要直接截断前面的搜索范围，后面的候选左端点不能越过该断点；\`k / k+1\` 则负责怎么更快找到它。
