Imports System.Threading
Imports CarveCAM.Core.Geometry

Namespace Cam

    ''' <summary>
    ''' Campionamento regolare del drop-cutter sul piano: H(i,j) = quota punta in (U0+i*Res, V0+j*Res).
    ''' Le isolinee a quota L delimitano la zona dove l'utensile, a quota L, entrerebbe in collisione
    ''' (spazio delle configurazioni). I punti di attraversamento sono raffinati con bisezione esatta.
    ''' </summary>
    Public NotInheritable Class HeightField
        Public ReadOnly U0 As Double
        Public ReadOnly V0 As Double
        Public ReadOnly Res As Double
        Public ReadOnly Nu As Integer
        Public ReadOnly Nv As Integer
        Public ReadOnly H As Double()
        Private ReadOnly _dc As DropCutter
        Private ReadOnly _floor As Double

        Public Sub New(dc As DropCutter, minU As Double, minV As Double, maxU As Double, maxV As Double,
                       res As Double, floor As Double, ct As CancellationToken)
            _dc = dc : _floor = floor
            Me.Res = res
            U0 = minU - 2 * res : V0 = minV - 2 * res
            Nu = CInt(Math.Ceiling((maxU + 2 * res - U0) / res)) + 1
            Nv = CInt(Math.Ceiling((maxV + 2 * res - V0) / res)) + 1
            Dim arr(Nu * Nv - 1) As Double
            Dim nuL = Nu, u0L = U0, v0L = V0
            Dim po As New ParallelOptions With {.CancellationToken = ct}
            Parallel.For(0, Nv, po,
                Sub(j)
                    Dim v = v0L + j * res
                    For i = 0 To nuL - 1
                        arr(j * nuL + i) = dc.Contact(u0L + i * res, v, floor)
                    Next
                End Sub)
            H = arr
        End Sub

        ''' <summary>
        ''' Campo da quote già note sui nodi (U0 + i·res, V0 + j·res), es. la sommità del grezzo: i punti di
        ''' attraversamento si interpolano linearmente tra i nodi.
        ''' </summary>
        Public Sub New(u0 As Double, v0 As Double, res As Double, nu As Integer, nv As Integer, h As Double())
            Me.U0 = u0 : Me.V0 = v0 : Me.Res = res
            Me.Nu = nu : Me.Nv = nv
            Me.H = h
        End Sub

        Public Function NodePos(i As Integer, j As Integer) As Vec2
            Return New Vec2(U0 + i * Res, V0 + j * Res)
        End Function

        Private Function Blocked(i As Integer, j As Integer, thr As Double) As Boolean
            If i < 0 OrElse j < 0 OrElse i >= Nu OrElse j >= Nv Then Return False
            Return H(j * Nu + i) > thr
        End Function

        Private Function HKey(i As Integer, j As Integer) As Long
            Return (CLng(j + 1) * (Nu + 2) + (i + 1)) * 2
        End Function

        Private Function VKey(i As Integer, j As Integer) As Long
            Return (CLng(j + 1) * (Nu + 2) + (i + 1)) * 2 + 1
        End Function

        ''' <summary>
        ''' Contorni chiusi della zona bloccata (quota di contatto &gt; level) con orientamento: zona bloccata a sinistra.
        ''' </summary>
        Public Function BlockedLoops(level As Double, ct As CancellationToken) As List(Of List(Of Vec2))
            Const EPS = 0.00001
            Dim thr = level + EPS
            Dim nextOf As New Dictionary(Of Long, Long)()
            Dim order As New List(Of Long)()
            For j = -1 To Nv - 1
                For i = -1 To Nu - 1
                    Dim idx = If(Blocked(i, j, thr), 1, 0) Or If(Blocked(i + 1, j, thr), 2, 0) Or
                              If(Blocked(i + 1, j + 1, thr), 4, 0) Or If(Blocked(i, j + 1, thr), 8, 0)
                    If idx = 0 OrElse idx = 15 Then Continue For
                    Dim e0 = HKey(i, j), e1 = VKey(i + 1, j), e2 = HKey(i, j + 1), e3 = VKey(i, j)
                    Select Case idx
                        Case 1 : Seg(nextOf, order, e0, e3)
                        Case 2 : Seg(nextOf, order, e1, e0)
                        Case 3 : Seg(nextOf, order, e1, e3)
                        Case 4 : Seg(nextOf, order, e2, e1)
                        Case 5 : Seg(nextOf, order, e0, e1) : Seg(nextOf, order, e2, e3)
                        Case 6 : Seg(nextOf, order, e2, e0)
                        Case 7 : Seg(nextOf, order, e2, e3)
                        Case 8 : Seg(nextOf, order, e3, e2)
                        Case 9 : Seg(nextOf, order, e0, e2)
                        Case 10 : Seg(nextOf, order, e3, e0) : Seg(nextOf, order, e1, e2)
                        Case 11 : Seg(nextOf, order, e1, e2)
                        Case 12 : Seg(nextOf, order, e3, e1)
                        Case 13 : Seg(nextOf, order, e0, e1)
                        Case 14 : Seg(nextOf, order, e3, e0)
                    End Select
                Next
            Next
            ct.ThrowIfCancellationRequested()

            ' posizione dei punti di attraversamento (bisezione esatta sul drop-cutter)
            Dim keys = order.ToArray()
            Dim pos(keys.Length - 1) As Vec2
            Dim keyIndex As New Dictionary(Of Long, Integer)(keys.Length)
            For k = 0 To keys.Length - 1
                keyIndex(keys(k)) = k
            Next
            Parallel.For(0, keys.Length, New ParallelOptions With {.CancellationToken = ct},
                Sub(k) pos(k) = CrossingPoint(keys(k), thr))

            Dim visited(keys.Length - 1) As Boolean
            Dim loops As New List(Of List(Of Vec2))()
            For k = 0 To keys.Length - 1
                If visited(k) Then Continue For
                Dim lp As New List(Of Vec2)()
                Dim cur = k
                Dim guard = 0
                Do
                    visited(cur) = True
                    lp.Add(pos(cur))
                    Dim nk As Long
                    If Not nextOf.TryGetValue(keys(cur), nk) Then Exit Do
                    Dim ni As Integer
                    If Not keyIndex.TryGetValue(nk, ni) Then Exit Do
                    cur = ni
                    guard += 1
                Loop While Not visited(cur) AndAlso guard <= keys.Length
                If lp.Count >= 3 Then loops.Add(lp)
            Next
            Return loops
        End Function

        Private Shared Sub Seg(nextOf As Dictionary(Of Long, Long), order As List(Of Long), a As Long, b As Long)
            nextOf(a) = b
            order.Add(a)
        End Sub

        Private Function CrossingPoint(key As Long, thr As Double) As Vec2
            Dim isV = (key And 1L) = 1L
            Dim cell = key \ 2
            Dim j = CInt(cell \ (Nu + 2)) - 1
            Dim i = CInt(cell Mod (Nu + 2)) - 1
            Dim i2 = If(isV, i, i + 1), j2 = If(isV, j + 1, j)
            Dim pa = NodePos(i, j), pb = NodePos(i2, j2)
            Dim inside = i >= 0 AndAlso j >= 0 AndAlso i2 < Nu AndAlso j2 < Nv
            If Not inside Then Return Vec2.Lerp(pa, pb, 0.5)
            If _dc Is Nothing Then
                ' quote dei nodi senza drop-cutter: interpolazione lineare (nodo vuoto: a metà)
                Dim ha = H(j * Nu + i), hb = H(j2 * Nu + i2)
                If ha < -1.0E+29 OrElse hb < -1.0E+29 OrElse Math.Abs(hb - ha) < 1.0E-12 Then Return Vec2.Lerp(pa, pb, 0.5)
                Return Vec2.Lerp(pa, pb, Math.Max(0, Math.Min(1, (thr - ha) / (hb - ha))))
            End If
            ' a = lato bloccato, b = lato libero
            Dim a = pa, b = pb
            If Not Blocked(i, j, thr) Then a = pb : b = pa
            For it = 1 To 14
                Dim m = Vec2.Lerp(a, b, 0.5)
                If _dc.Contact(m.X, m.Y, _floor) > thr Then a = m Else b = m
            Next
            Return b
        End Function

    End Class

End Namespace
