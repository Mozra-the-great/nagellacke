package de.nagellacke.domain

import java.security.MessageDigest

/**
 * Client side of the server's registration proof of work (#324 S13, scheme in
 * v3/server/src/pow.ts): find the smallest `n` for which sha256(salt + n) starts with
 * `difficulty` zero bits. At the server's 16 bits that is ~65 000 hashes on average,
 * a fraction of a second on a phone. Pure JVM, so it is unit-tested without Android.
 */
object Pow {
    fun hasLeadingZeroBits(hash: ByteArray, bits: Int): Boolean {
        val fullBytes = bits / 8
        for (i in 0 until fullBytes) if (hash[i].toInt() != 0) return false
        val rest = bits % 8
        if (rest == 0) return true
        return (hash[fullBytes].toInt() and 0xff) shr (8 - rest) == 0
    }

    fun solve(salt: String, difficulty: Int): Long {
        val digest = MessageDigest.getInstance("SHA-256")
        var n = 0L
        while (true) {
            if (hasLeadingZeroBits(digest.digest("$salt$n".toByteArray(Charsets.UTF_8)), difficulty)) return n
            n++
        }
    }
}
